import { RemoteInfo } from 'dgram'
import { Answer, StringAnswer } from 'dns-packet'
import { ResponsePacket } from 'multicast-dns'

import { decodeTXT, nameEquals, ServiceType } from '../utils'

// MARK: DiscoveredService
/**
 * Represents a discovered mDNS/DNS-SD service instance, as defined in the DNS-Based Service Discovery specification.
 *
 * A `DiscoveredService` is constructed from multiple DNS resource records typically found in an mDNS response:
 * - A {@link https://datatracker.ietf.org/doc/html/rfc6763#section-4.1 | PTR record} that points to the instance's FQDN.
 * - An {@link https://datatracker.ietf.org/doc/html/rfc6763#section-4.1.2 | SRV record} that provides the target host and port.
 * - A {@link https://datatracker.ietf.org/doc/html/rfc6763#section-6 | TXT record} containing key-value metadata.
 * - One or more {@link https://datatracker.ietf.org/doc/html/rfc6762#section-5.4 | A or AAAA records} for IP addresses.
 * - Optionally, additional {@link https://datatracker.ietf.org/doc/html/rfc6763#section-7.1 | subtype PTR records} for selective discovery.
 *
 * All records are typically retrieved from a single mDNS response.
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-4 | RFC 6763 § 4: Service Instances}
 * @see {@link https://datatracker.ietf.org/doc/html/rfc2782 | RFC 2782 - DNS SRV Records}
 * @see {@link https://datatracker.ietf.org/doc/html/rfc6762 | RFC 6762 - Multicast DNS}
 */
export class DiscoveredService {
  /**
   * Creates a list of `DiscoveredService` instances from a DNS response packet.
   *
   * This function filters out records with expired TTL, finds matching PTR records for the given service name,
   * and builds structured `DiscoveredService` objects by resolving their associated SRV, TXT, A/AAAA, and subtype PTR records.
   *
   * @internal
   * @param name - The service name to match (e.g., `_http._tcp.local`).
   * @param packet - The full mDNS response packet containing DNS records.
   * @param referer - Network information about the source of the packet.
   * @returns An array of discovered service instances matching the given name.
   */
  static fromResponse(packet: ResponsePacket, referer: RemoteInfo): DiscoveredService[] {
    const answers: Answer[] = []

    // Collect all relevant resource records with valid TTL (ignores goodbye messages)
    for (const answer of [...packet.answers, ...packet.additionals]) {
      if ('ttl' in answer && answer.ttl !== undefined && answer.ttl > 0) {
        answers.push(answer)
      }
    }

    const services: DiscoveredService[] = []

    // Find matching PTR records and construct DiscoveredService instances
    for (const ptr of answers) {
      if (ptr.type === 'PTR') {
        const service = this.fromPTR(ptr, answers, referer)
        if (service) {
          services.push(service)
        }
      }
    }

    return services
  }

  /**
   * Constructs a `DiscoveredService` instance from a PTR record and its associated resource records.
   *
   * This method finds the corresponding SRV record for service connection details, optional TXT records
   * for metadata, subtype PTR records for selective discovery, and A/AAAA records for resolving IP addresses.
   *
   * @internal
   * @param ptr - The PTR record pointing to a service instance.
   * @param answers - A list of resource records from the DNS response to search through.
   * @param referer - The network information of the source of the response.
   * @returns A `DiscoveredService` instance or `null` if a valid SRV record is not found.
   */
  private static fromPTR(ptr: StringAnswer, answers: Answer[], referer: RemoteInfo): DiscoveredService | null {
    let service: DiscoveredService | undefined

    // Look for the SRV record that defines host and port
    for (const answer of answers) {
      if (answer.type === 'SRV' && nameEquals(answer.name, ptr.data)) {
        const fqdn = answer.name
        const name = fqdn.split('.')[0]
        if (name === undefined) {
          console.error('Invalid service name', name)
          return null
        }

        const host = answer.data.target
        const port = answer.data.port

        /** @remarks Only the TTL of the PTR record is used for simplicity and compatibility */
        service = new DiscoveredService(name, fqdn, host, port, referer, ptr.ttl, Date.now())
      }
    }

    if (!service) return null

    // Attach TXT metadata if available
    for (const answer of answers) {
      if (answer.type === 'TXT' && nameEquals(answer.name, ptr.data)) {
        service.txt = decodeTXT(answer.data, /* binary */ false)
        service.binaryTxt = decodeTXT(answer.data, /* binary */ true)
        service.rawTxt = answer.data
      }
    }

    // Collect any advertised subtypes (via _sub PTR records)
    for (const answer of answers) {
      if (answer.type === 'PTR' && nameEquals(answer.data, ptr.data) && answer.name.includes('._sub')) {
        const types = ServiceType.fromString(answer.name)
        if (types.subtype !== undefined) {
          service.subtypes.push(types.subtype)
        }
      }
    }

    // Resolve host IP addresses (A/AAAA)
    for (const answer of answers) {
      if ((answer.type === 'A' || answer.type === 'AAAA') && service.host && nameEquals(answer.name, service.host)) {
        service.addresses.push(answer.data)
      }
    }

    return service
  }

  /**
   * The registered service type (e.g., _http, _ipp).
   * @example "ipp"
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-4.1.2}
   */
  type?: string
  /**
   * Network protocol used by the service (_tcp or _udp).
   * @example "tcp"
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-4.1.2}
   */
  protocol?: string
  /**
   * Subtypes advertised by the service for selective discovery.
   * @example ["scanner", "fax"]
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-7.1}
   */
  subtypes: string[] = []

  /**
   * Resolved IPv4/IPv6 addresses of the service host.
   * @example ["192.168.1.42", "fe80::1c2a:3bff:fe4e:1234"]
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6762#section-5.4}
   */
  addresses: string[] = []

  /**
   * Decoded TXT record key-value pairs.
   * @example { "note": "Office printer", "paper": "A4" }
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-6}
   */
  txt?: Record<string, string>
  /**
   * Decoded binary TXT record key-value pairs.
   * @example { "note": <Buffer 04 6e 6f 74 65 0b 4f 66 69 63 65 20 50 72 69 6e 74 65 72> }
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-6}
   */
  binaryTxt?: Record<string, Buffer>
  /**
   * Raw TXT record data as received over the network.
   * @example <Buffer 04 6e 6f 74 65 0b 4f 66 66 69 63 65 20 50 72 69 6e 74 65 72>
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-6}
   */
  rawTxt?: string | Buffer | (string | Buffer)[]

  /**
   * Timer for checking TTL expiration.
   */
  ttlTimer?: NodeJS.Timeout

  private constructor(
    /**
     * Short instance name of the service (first label of the FQDN).
     * @example "MyPrinter"
     * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-4.1.1}
     */
    readonly name: string,
    /**
     * Fully qualified domain name (e.g., MyPrinter._ipp._tcp.local).
     * @example "MyPrinter._ipp._tcp.local"
     * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-4.1.1}
     */
    readonly fqdn: string,
    /**
     * Hostname of the machine offering the service (SRV record target).
     * @example "MyPrinter.local"
     * @see {@link https://datatracker.ietf.org/doc/html/rfc2782}
     */
    readonly host: string,
    /**
     * TCP or UDP port on which the service is running.
     * @example 631
     * @see {@link https://datatracker.ietf.org/doc/html/rfc2782}
     */
    readonly port: number,
    /**
     * Network info about where the service response came from.
     * @example { address: "192.168.1.101", family: "IPv4", port: 5353, size: 412 }
     * @see {@link https://datatracker.ietf.org/doc/html/rfc6762#section-5}
     */
    readonly referer: RemoteInfo,

    /**
     * Time-to-live value in seconds.
     * @example 120
     * @see {@link https://datatracker.ietf.org/doc/html/rfc6762#section-10}
     */
    readonly ttl: number | undefined,
    /**
     * Last time the service was seen (in milliseconds since the Unix epoch).
     * @example 1634567890000
     */
    readonly lastSeen: number,
  ) {
    const serviceType = ServiceType.fromString(fqdn.split('.').slice(1, -1).join('.'))
    this.type = serviceType.name
    this.protocol = serviceType.protocol
  }

  get expired(): boolean {
    return this.ttl !== undefined && Date.now() > this.lastSeen + this.ttl * 1000
  }
}
