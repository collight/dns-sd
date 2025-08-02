import { EventEmitter } from 'events'
import os from 'os'
import { SrvAnswer, StringAnswer, TxtAnswer } from 'dns-packet'

import { encodeTXT, MDNSRecord, ServiceType } from '../utils'
import { Registry } from './Registry'

// MARK: ServiceOptions
/**
 * Options used to configure a service instance.
 */
export interface ServiceOptions {
  /**
   * The protocol used by the service, typically "tcp" or "udp".
   * @default 'tcp'
   */
  protocol?: string
  /**
   * The service type (e.g., "http", "ipp").
   * Used to form the full service type domain.
   */
  type: string
  /**
   * Optional list of subtype identifiers for selective discovery.
   */
  subtypes?: string[]
  /**
   * The instance name of the service.
   * This will be sanitized by replacing dots with dashes.
   * @example 'MyPrinter'
   */
  name: string

  /**
   * The hostname of the machine offering the service.
   * @default os.hostname()
   */
  host?: string
  /**
   * The port number on which the service is listening.
   */
  port: number

  /**
   * Optional TXT record key-value pairs to advertise service metadata.
   */
  txt?: Record<string, string | number | boolean | Buffer>

  /**
   * The TTL (time to live) in seconds for the all records.
   * @remarks The same TTL is set to all records (PTR, SRV, TXT, A, AAAA) for simplicity and compatibility.
   * @default 28800
   */
  ttl?: number

  /**
   * Whether to perform probing to detect name conflicts before publishing.
   * @default true
   */
  probe?: boolean
  /**
   * Whether to automatically resolve name conflicts by appending a number to the service name.
   * @default true
   */
  probeAutoResolve?: boolean

  /**
   * Whether to disable publishing IPv6 addresses for this service.
   * @default false
   */
  disableIPv6?: boolean
}

interface ServiceEventMap {
  up: []
  down: []
}

// MARK: Service
/**
 * Represents a service registered on the local network via mDNS/DNS-SD.
 *
 * This class manages the service's DNS resource records such as PTR, SRV, TXT, A, and AAAA,
 * constructed according to the DNS-Based Service Discovery specification.
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc6763 | RFC 6763 - DNS-Based Service Discovery}
 * @see {@link https://datatracker.ietf.org/doc/html/rfc6762 | RFC 6762 - Multicast DNS}
 */
export class Service extends EventEmitter<ServiceEventMap> implements Required<ServiceOptions> {
  static TLD = '.local'

  protocol: string
  type: string
  name: string
  subtypes: string[]

  host: string
  port: number

  txt: Record<string, string | number | boolean | Buffer>

  ttl: number

  probe = true
  probeAutoResolve = true
  disableIPv6: boolean

  fqdn: string

  started = false
  published = false
  destroyed = false

  registry?: Registry

  constructor(options: ServiceOptions) {
    super()

    if (options.port <= 0 || options.port > 65535) {
      throw new Error('Invalid port number')
    }

    this.protocol = options.protocol ?? 'tcp'
    this.type = new ServiceType(options.type, this.protocol).toString()
    this.subtypes = options.subtypes ?? []
    this.name = options.name.split('.').join('-')

    this.host = options.host ?? os.hostname()
    this.port = options.port

    this.txt = options.txt ?? {}

    this.ttl = options.ttl ?? 28800

    this.probe = options.probe ?? true
    this.probeAutoResolve = options.probeAutoResolve ?? true

    this.disableIPv6 = options.disableIPv6 ?? false

    this.fqdn = `${this.name}.${this.type}${Service.TLD}`
  }

  /**
   * Starts the registered service, initiating its publication on the network.
   *
   * If the service has already been started, this method does nothing.
   */
  async start(): Promise<void> {
    if (!this.started) {
      this.started = true
      await this.registry?.onServiceStart(this)
    }
  }

  /**
   * Stops the registered service and removes it from the network.
   */
  async stop() {
    if (this.started) {
      this.started = false
      await this.registry?.onServiceStop(this)
    }
  }

  /**
   * Generates all DNS resource records representing this service instance.
   *
   * This includes:
   * - PTR record for the service type
   * - SRV record with host and port
   * - TXT record with metadata
   * - PTR record advertising the service type in the _services._dns-sd._udp.local domain
   * - PTR records for any declared subtypes
   * - A and AAAA records for each network interface address (unless IPv6 is disabled)
   *
   * @returns An array of DNS resource records suitable for publishing via mDNS.
   */
  getRecords(): MDNSRecord[] {
    const records: MDNSRecord[] = [
      this.getRecordPTR(),
      this.getRecordSRV(),
      this.getRecordTXT(),
      this.getRecordPTRServiceTypeEnumeration(),
    ]

    // Handle subtypes
    for (const subtype of this.subtypes) {
      records.push(this.getRecordPTRSubtype(subtype))
    }

    // Create record per interface address
    const ifaces = Object.values(os.networkInterfaces())
    for (const iface of ifaces) {
      for (const addr of iface ?? []) {
        if (addr.internal || addr.mac === '00:00:00:00:00:00') {
          continue
        }
        if (addr.family === 'IPv4') {
          records.push(this.getRecordA(addr.address))
        } else {
          if (this.disableIPv6) continue
          records.push(this.getRecordAAAA(addr.address))
        }
      }
    }

    // Return all records
    return records
  }

  // MARK: private
  /**
   * Constructs the main PTR record pointing to this instance's FQDN.
   *
   * This advertises the presence of a service instance under the service type domain.
   *
   * @returns A PTR record for service instance discovery.
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-4.1 | RFC 6763 §4.1 - Structured Service Instance Names}
   */
  private getRecordPTR(): StringAnswer {
    return {
      type: 'PTR',
      name: `${this.type}${Service.TLD}`,
      ttl: this.ttl,
      data: this.fqdn,
    }
  }

  /**
   * Constructs a subtype PTR record to support selective instance discovery by subtype.
   *
   * This record maps from a subtype-specific domain to the instance FQDN.
   *
   * @param subtype - The subtype identifier (e.g., "printer").
   * @returns A subtype-specific PTR record.
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-7.1 | RFC 6763 §7.1 - Selective Instance Enumeration (Subtypes)}
   */
  private getRecordPTRSubtype(subtype: string): StringAnswer {
    return {
      type: 'PTR',
      name: `_${subtype}._sub.${this.type}${Service.TLD}`,
      ttl: this.ttl,
      data: `${this.name}.${this.type}${Service.TLD}`,
    }
  }

  /**
   * Constructs a PTR record under the special _services._dns-sd._udp.local name.
   *
   * This enables enumeration of available service types on the local network.
   *
   * @returns A PTR record pointing to this service type.
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-9 | RFC 6763 §9 - Service Type Enumeration}
   */
  private getRecordPTRServiceTypeEnumeration(): StringAnswer {
    return {
      type: 'PTR',
      name: `_services._dns-sd._udp${Service.TLD}`,
      ttl: this.ttl,
      data: `${this.type}${Service.TLD}`,
    }
  }

  /**
   * Constructs an SRV record that contains the target host and port of this service.
   *
   * This enables clients to locate the host and communication endpoint.
   *
   * @returns An SRV record for this service instance.
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-4.1 | RFC 6763 §4.1 - Structured Service Instance Names}
   * @see {@link https://datatracker.ietf.org/doc/html/rfc2782 | RFC 2782 - A DNS RR for specifying the location of services (DNS SRV)}
   */
  private getRecordSRV(): SrvAnswer {
    return {
      type: 'SRV',
      name: this.fqdn,
      ttl: this.ttl,
      data: {
        port: this.port,
        target: this.host,
      },
    }
  }

  /**
   * Constructs a TXT record carrying metadata key-value pairs about the service.
   *
   * Keys should be lowercase and limited in length. Empty value fields are valid.
   *
   * @returns A TXT record representing service metadata.
   *
   * The name of a TXT record is the same name as the SRV record
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-6 | RFC 6763 §6 - Data Syntax for DNS-SD TXT Records}
   */
  private getRecordTXT(): TxtAnswer {
    return {
      type: 'TXT',
      name: this.fqdn,
      ttl: this.ttl,
      data: encodeTXT(this.txt),
    }
  }

  /**
   * Constructs an A record mapping the hostname to an IPv4 address.
   *
   * @param ip - The IPv4 address associated with the service host.
   * @returns An A record for IPv4 address resolution.
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6762#section-6 | RFC 6762 §6 - Responding}
   */
  private getRecordA(ip: string): StringAnswer {
    return {
      type: 'A',
      name: this.host,
      ttl: this.ttl,
      data: ip,
    }
  }

  /**
   * Constructs an AAAA record mapping the hostname to an IPv6 address.
   *
   * @param ip - The IPv6 address associated with the service host.
   * @returns An AAAA record for IPv6 address resolution.
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6762#section-6 | RFC 6762 §6 - Responding}
   */
  private getRecordAAAA(ip: string): StringAnswer {
    return {
      type: 'AAAA',
      name: this.host,
      ttl: this.ttl,
      data: ip,
    }
  }
}
