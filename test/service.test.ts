import os from 'node:os'
import { describe, expect, it } from 'vitest'

import { Service } from '../src' // Adjust import path as needed

function getAddressesRecords(host: string, ttl: number) {
  const records = []
  const itrs = Object.values(os.networkInterfaces())
  for (const addrs of itrs) {
    for (const { internal, address, family, mac } of addrs ?? []) {
      if (!internal && mac !== '00:00:00:00:00:00') {
        records.push({ data: address, name: host, ttl, type: family === 'IPv4' ? 'A' : 'AAAA' })
      }
    }
  }
  return records
}

describe('service', () => {
  // MARK: new
  describe('new', () => {
    it('should create a minimal new Service', () => {
      const s = new Service({ name: 'Foo Bar', type: 'http', port: 3000 })

      expect(s.name).toBe('Foo Bar')
      expect(s.protocol).toBe('tcp')
      expect(s.type).toBe('_http._tcp')
      expect(s.host).toBe(os.hostname())
      expect(s.port).toBe(3000)
      expect(s.fqdn).toBe('Foo Bar._http._tcp.local')
      expect(s.txt).toStrictEqual({})
      expect(s.subtypes).toStrictEqual([])
      expect(s.published).toBe(false)
    })

    it('should respect custom protocol (udp)', () => {
      const s = new Service({
        name: 'Foo Bar',
        type: 'http',
        port: 3000,
        protocol: 'udp',
      })
      expect(s.protocol).toBe('udp')
    })

    it('should accept custom host', () => {
      const s = new Service({
        name: 'Foo Bar',
        type: 'http',
        port: 3000,
        host: 'example.com',
      })
      expect(s.host).toBe('example.com')
    })

    it('should parse TXT records', () => {
      const s = new Service({
        name: 'Foo Bar',
        type: 'http',
        port: 3000,
        txt: { foo: 'bar' },
      })
      expect(s.txt).toEqual({ foo: 'bar' }) // `.toEqual` for deep comparison
    })

    it('should handle subtypes', () => {
      const s = new Service({
        name: 'Foo Bar',
        type: 'http',
        port: 3000,
        subtypes: ['foo', 'bar'],
      })
      expect(s.subtypes).toEqual(['foo', 'bar']) // `.toEqual` for arrays/objects
    })
  })

  // MARK: records
  describe('records', () => {
    it('should create minimal records', () => {
      const s = new Service({ name: 'Foo Bar', type: 'http', protocol: 'tcp', port: 3000 })
      expect(s.getRecords()).toEqual(
        [
          {
            type: 'PTR',
            name: '_http._tcp.local',
            ttl: 28800,
            data: s.fqdn,
          },
          {
            type: 'SRV',
            name: s.fqdn,
            ttl: 28800,
            data: { port: 3000, target: os.hostname() },
          },
          {
            type: 'TXT',
            name: s.fqdn,
            ttl: 28800,
            data: [],
          },
          {
            type: 'PTR',
            name: '_services._dns-sd._udp.local',
            ttl: 28800,
            data: '_http._tcp.local',
          },
        ].concat(getAddressesRecords(s.host, 28800)),
      )
    })

    it('should create records with custom data', () => {
      const s = new Service({
        name: 'Foo Bar',
        type: 'http',
        protocol: 'tcp',
        port: 3000,
        host: 'example.com',
        txt: { foo: 'bar' },
        subtypes: ['foo', 'bar'],
        ttl: 120,
      })
      expect(s.getRecords()).toEqual(
        [
          {
            type: 'PTR',
            name: '_http._tcp.local',
            ttl: 120,
            data: s.fqdn,
          },
          {
            type: 'SRV',
            name: s.fqdn,
            ttl: 120,
            data: { port: 3000, target: 'example.com' },
          },
          {
            type: 'TXT',
            name: s.fqdn,
            ttl: 120,
            data: [Buffer.from('666f6f3d626172', 'hex')],
          },
          {
            type: 'PTR',
            name: '_services._dns-sd._udp.local',
            ttl: 120,
            data: '_http._tcp.local',
          },
          {
            type: 'PTR',
            name: '_foo._sub._http._tcp.local',
            ttl: 120,
            data: s.fqdn,
          },
          {
            type: 'PTR',
            name: '_bar._sub._http._tcp.local',
            ttl: 120,
            data: s.fqdn,
          },
        ].concat(getAddressesRecords(s.host, 120)),
      )
    })
  })
})
