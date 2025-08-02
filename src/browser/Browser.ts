import { RemoteInfo } from 'dgram'
import { EventEmitter } from 'events'
import { MulticastDNS, ResponsePacket } from 'multicast-dns'

import { nameEquals, ServiceType } from '../utils'
import { DiscoveredService } from './DiscoveredService'

// MARK: BrowserFilter
export type BrowserFilter = {
  /**
   * Network protocol used by the service, either TCP or UDP.
   * @default 'tcp'
   */
  protocol: 'tcp' | 'udp'
  /**
   * The service type to browse for. This corresponds to the DNS-SD service type without the leading underscore.
   * @example 'http', 'ipp'
   */
  type: string
  /**
   * Optional service subtypes to filter for. When provided, the browser targets this instance specifically.
   * @example ['foo', 'bar']
   */
  subtypes?: string[]

  /**
   * Optional specific instance name to filter for. When provided, the browser targets this instance specifically.
   * @example 'MyPrinter'
   */
  name?: string | RegExp
  /**
   * Optional TXT record key-value pairs to filter discovered services.
   * Only services whose TXT records match all keys and values will be emitted.
   */
  txt?: Record<string, string | RegExp>
}

// MARK: BrowserOptions
export interface BrowserOptions {
  filter?: BrowserFilter
}

interface BrowserEventMap {
  up: [service: DiscoveredService]
  down: [service: DiscoveredService]
  update: [service: DiscoveredService]
}

// MARK: Browser
/**
 * Browses the local network for mDNS/DNS-SD service instances.
 *
 * Emits:
 * - `up`: when a new service appears.
 * - `down`: when a previously seen service sends a "goodbye" (TTL = 0).
 * - `update`: when a service's TXT record content changes.
 */
export class Browser extends EventEmitter<BrowserEventMap> {
  static TLD = '.local'
  static WILDCARD = '_services._dns-sd._udp' + this.TLD

  services: DiscoveredService[] = []

  private mdns: MulticastDNS
  private filter?: BrowserFilter

  private onresponse?: (packet: ResponsePacket, rinfo: RemoteInfo) => void

  constructor(mdns: MulticastDNS, options?: BrowserOptions) {
    super()

    this.mdns = mdns
    this.filter = options?.filter
  }

  private get queryNames(): string[] {
    if (!this.filter) {
      return [Browser.WILDCARD]
    }

    const { protocol, type, name, subtypes } = this.filter
    const types =
      subtypes && subtypes.length > 0
        ? subtypes.map(subtype => new ServiceType(type, protocol, subtype).toString())
        : [new ServiceType(type, protocol).toString()]

    return types.map((typeStr: string) =>
      typeof name === 'string' ? `${name}.${typeStr}${Browser.TLD}` : `${typeStr}${Browser.TLD}`,
    )
  }

  /**
   * Starts the browser and begins listening for mDNS service announcements.
   * - Has no effect if the browser is already started.
   */
  start() {
    if (this.onresponse) return

    this.onresponse = (packet: ResponsePacket, rinfo: RemoteInfo) => {
      // Handle goodbye records (TTL = 0) to remove offline services
      // See https://tools.ietf.org/html/rfc6762#section-8.4
      for (const answer of [...packet.answers, ...packet.additionals]) {
        if (answer.type === 'PTR' && answer.ttl === 0) {
          this.removeService(answer.data)
        }
      }

      // Discover new services from valid responses
      const services = DiscoveredService.fromResponse(packet, rinfo)
      if (services.length === 0) return

      for (const service of services) {
        if (this.services.some(s => nameEquals(s.fqdn, service.fqdn))) {
          this.updateService(service)
        } else {
          this.addService(service)
        }
      }
    }

    this.mdns.on('response', this.onresponse)

    // trigger initial query
    this.update()
  }

  /**
   * Stops the browser from listening to mDNS service announcements.
   * - Has no effect if the browser is already stopped
   */
  stop() {
    if (!this.onresponse) return

    this.mdns.removeListener('response', this.onresponse)
    this.onresponse = undefined

    for (const service of this.services) {
      clearTimeout(service.ttlTimer)
    }
    this.services = []
  }

  /**
   * Sends an active query to refresh the list of discovered services.
   * - Triggers a new PTR record query for the configured service name
   * - Causes mDNS responders to reply with their current service information
   * - Useful for manual refresh when you suspect stale service data
   */
  update() {
    // Actively query for service PTR records
    for (const queryName of this.queryNames) {
      this.mdns.query(queryName, 'PTR')
    }
  }

  // MARK: private
  private match(service: DiscoveredService): boolean {
    if (!this.filter) {
      return true
    }
    const { protocol, type, subtypes, name, txt } = this.filter
    if (protocol !== service.protocol) {
      return false
    }
    if (type !== service.type) {
      return false
    }
    if (subtypes?.some(s => !service.subtypes.includes(s)) ?? false) {
      return false
    }
    if (name !== undefined) {
      if (typeof name === 'string' && !nameEquals(name, service.name)) {
        return false
      }
      if (name instanceof RegExp && !name.test(service.name)) {
        return false
      }
    }
    if (txt) {
      for (const [key, value] of Object.entries(txt)) {
        if (service.txt?.[key] === undefined) {
          return false
        }
        if (typeof value === 'string' && value !== service.txt[key]) {
          return false
        }
        if (value instanceof RegExp && !value.test(service.txt[key])) {
          return false
        }
      }
    }
    return true
  }

  /**
   * TODO: {@link https://datatracker.ietf.org/doc/html/rfc6762#section-5.2 | Continuous Multicast DNS Querying}
   */
  private setupTTLTimer(service: DiscoveredService) {
    if (service.ttl !== undefined) {
      service.ttlTimer = setTimeout(() => {
        if (service.expired) {
          this.removeService(service.fqdn)
        }
      }, service.ttl * 1000)
    }
  }

  private addService(service: DiscoveredService) {
    if (!this.match(service)) {
      return
    }

    this.services.push(service)

    this.setupTTLTimer(service)

    this.emit('up', service)
  }

  private updateService(service: DiscoveredService) {
    // If the new updated service no longer matches the filter, remove the service
    if (!this.match(service)) {
      this.removeService(service.fqdn)
      return
    }

    // Replace the old service instance
    for (let i = 0; i < this.services.length; ++i) {
      const s = this.services[i]!
      if (nameEquals(s.fqdn, service.fqdn)) {
        clearTimeout(s.ttlTimer)
        this.services[i] = service
      }
    }

    this.setupTTLTimer(service)

    this.emit('update', service)
  }

  private removeService(fqdn: string) {
    for (let i = 0; i < this.services.length; ++i) {
      const s = this.services[i]
      if (s && nameEquals(s.fqdn, fqdn)) {
        this.services.splice(i, 1)
        clearTimeout(s.ttlTimer)
        this.emit('down', s)
        return
      }
    }
  }
}
