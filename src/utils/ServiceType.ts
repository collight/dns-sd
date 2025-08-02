// MARK: ServiceType
/**
 * Represents a network service type with optional protocol and subtype.
 */
export class ServiceType {
  readonly name?: string
  readonly protocol?: string
  readonly subtype?: string

  constructor(name?: string, protocol?: string, subtype?: string) {
    this.name = name
    this.protocol = protocol
    this.subtype = subtype
  }

  /**
   * Parses a service type string into a ServiceType instance.
   *
   * Expected formats include:
   * - "_http._tcp"
   * - "_printer._sub._http._tcp" (a subtype "printer" of "_http._tcp")
   *
   * @param {string} input - The service type string to parse.
   * @returns {ServiceType} The parsed ServiceType instance.
   *
   * @example
   * ServiceType.fromString('_http._tcp');
   * // { name: "http", protocol: "tcp", subtype: undefined }
   *
   * ServiceType.fromString('_printer._sub._http._tcp');
   * // { name: "http", protocol: "tcp", subtype: "printer" }
   *
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6763#section-7.1 | RFC 6763 §7.1 Selective Instance Enumeration (Subtypes)}
   */
  static fromString(input: string): ServiceType {
    if (!input) throw new Error('Service type string is empty')

    let parts = input.split('.').map(p => p.trim())

    // Remove leading underscores from each part
    parts = parts.map(part => (part.startsWith('_') ? part.slice(1) : part))

    // Look for 'sub' marker and extract subtype accordingly
    let subtype: string | undefined
    const subIndex = parts.indexOf('sub')

    let name: string | undefined
    let protocol: string | undefined

    if (subIndex !== -1) {
      // subtype is the part before 'sub'
      if (subIndex === 0) {
        throw new Error('Invalid service type: "sub" cannot be first element')
      }
      subtype = parts[subIndex - 1]
      // name and protocol are after 'sub'
      name = parts[subIndex + 1]
      protocol = parts[subIndex + 2]
    } else {
      // no subtype: assume first two parts are name and protocol
      name = parts[0]
      protocol = parts[1]
    }

    if (name === undefined || protocol === undefined) {
      throw new Error('Invalid service type format: missing name or protocol')
    }

    return new ServiceType(name, protocol, subtype)
  }

  /**
   * Serializes the ServiceType instance into a string following DNS-SD format.
   *
   * @returns {string} The serialized service type string.
   *
   * @example
   * const svc = new ServiceType('http', 'tcp');
   * console.log(svc.toString()); // _http._tcp
   *
   * const svcWithSubtype = new ServiceType('http', 'tcp', 'printer');
   * console.log(svcWithSubtype.toString()); // _printer._sub._http._tcp
   */
  toString(): string {
    const parts: string[] = []

    if (this.subtype !== undefined) {
      parts.push(`_${this.subtype}`)
      parts.push('_sub')
    }

    if (this.name !== undefined) parts.push(`_${this.name}`)
    if (this.protocol !== undefined) parts.push(`_${this.protocol}`)

    return parts.join('.')
  }
}
