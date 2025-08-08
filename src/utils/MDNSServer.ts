import { EventEmitter } from 'events'
import { RecordType, SrvAnswer, StringAnswer, TxtAnswer } from 'dns-packet'
import deepEqual from 'fast-deep-equal'
import mDNS, { MulticastDNS, QueryPacket } from 'multicast-dns'

import { nameEquals } from './dns-utils'

/**
 * Represents a DNS Resource Record relevant for mDNS responses.
 */
export type MDNSRecord = StringAnswer | TxtAnswer | SrvAnswer

type EventMap = {
  responded: [packet: mDNS.ResponseOutgoingPacket, error: Error | null, bytes?: number]
}

// MARK: MDNSServer
/**
 * An mDNS server that responds to DNS queries on the local network.
 *
 * Maintains a registry of published records and automatically responds
 * to queries using the multicast-dns protocol.
 *
 * Emits:
 * - `responded` when a response is sent to a query
 *
 * @example
 * ```ts
 * const server = new MDNSServer({}, console.error)
 * server.register([{ name: '_http._tcp.local', type: 'PTR', data: 'MyService._http._tcp.local' }])
 * ```
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6762
 */
export class MDNSServer extends EventEmitter<EventMap> {
  mdns: MulticastDNS

  private typeToRecords = new Map<RecordType, MDNSRecord[]>()

  /**
   * @param options - Configuration passed to the underlying `multicast-dns` instance.
   */
  constructor(options: mDNS.Options) {
    super()

    this.mdns = mDNS(options)
    this.mdns.setMaxListeners(0)
    this.mdns.on('query', q => this.respond(q))
  }

  /**
   * Registers a list of DNS records to be used in future responses.
   *
   * Duplicate records (based on type, name, and deep equality of data) are ignored.
   *
   * @param records - An array of mDNS records to register.
   */
  register(records: MDNSRecord[]): void {
    function isDuplicate(a: MDNSRecord, b: MDNSRecord): boolean {
      return a.type === b.type && a.name === b.name && deepEqual(a.data, b.data)
    }

    for (const record of records) {
      const type = record.type
      const records = this.typeToRecords.get(type) ?? []
      if (records.every(r => !isDuplicate(r, record))) {
        records.push(record)
      }
      this.typeToRecords.set(type, records)
    }
  }

  /**
   * Unregisters a set of previously registered DNS records.
   *
   * Matching is done by `record.name` only (not deeply).
   *
   * @param records - Records to remove from the server registry.
   */
  unregister(records: MDNSRecord[]): void {
    for (const record of records) {
      const type = record.type
      const records = this.typeToRecords.get(type) ?? []
      const filtered = records.filter(r => r.name !== record.name)
      if (filtered.length > 0) {
        this.typeToRecords.set(type, filtered)
      } else {
        this.typeToRecords.delete(type)
      }
    }
  }

  // MARK: private
  /**
   * Returns all records of a given type matching a name.
   *
   * If the name is not fully qualified (no dot), only the first segment of the record name is compared.
   *
   * @param type - DNS record type.
   * @param name - Name to match against.
   * @returns Matching records.
   */
  private getRecordsOf(type: RecordType, name: string): MDNSRecord[] {
    const records: MDNSRecord[] = []
    for (const record of this.typeToRecords.get(type) ?? []) {
      const targetName = name.includes('.') ? record.name : record.name.split('.')[0]
      if (targetName !== undefined && nameEquals(targetName, name)) {
        records.push(record)
      }
    }
    return records
  }

  /**
   * Responds to incoming mDNS queries with matching registered records.
   * Handles `ANY` queries and populates additional records for `PTR → SRV → A/AAAA + TXT` dependencies,
   *
   * @param query - The incoming mDNS query packet.
   *
   * @see {@link https://www.rfc-editor.org/rfc/rfc6763#section-12}
   */
  private respond(query: QueryPacket): void {
    for (const question of query.questions) {
      const queryType = question.type as RecordType | 'ANY'
      const queryName = question.name

      let answers: MDNSRecord[]
      if (queryType === 'ANY') {
        answers = Array.from(this.typeToRecords.keys()).flatMap(type => this.getRecordsOf(type, queryName))
      } else {
        answers = this.getRecordsOf(queryType, queryName)
      }

      if (answers.length === 0) continue

      const additionals: MDNSRecord[] = []
      if (queryType !== 'ANY') {
        for (const answer of answers) {
          // Add SRV and TXT records if PTR is present
          if (answer.type === 'PTR') {
            additionals.push(...this.getRecordsOf('SRV', answer.data))
            additionals.push(...this.getRecordsOf('TXT', answer.data))
          }
        }

        // Collect unique SRV targets to enrich with A/AAAA
        const targets = new Set<string>()
        for (const record of additionals) {
          if (record.type === 'SRV') {
            const target = record.data.target
            targets.add(target)
          }
        }

        for (const target of targets) {
          additionals.push(...this.getRecordsOf('A', target))
          additionals.push(...this.getRecordsOf('AAAA', target))
        }
      }

      const packet: mDNS.ResponseOutgoingPacket = { answers, additionals }
      this.mdns.respond(packet, (...args) => {
        this.emit('responded', packet, ...args)
      })
    }
  }
}
