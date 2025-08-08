import dgram from 'dgram'
import os from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DNSSD } from '../src'

function getAddresses(): string[] {
  const addresses: string[] = []
  const itrs = Object.values(os.networkInterfaces())
  for (const addrs of itrs) {
    for (const { internal, mac, address } of addrs ?? []) {
      if (!internal && mac !== '00:00:00:00:00:00' && address && !addresses.includes(address)) {
        addresses.push(address)
      }
    }
  }
  return addresses
}

function filterDuplicates(input: string[]): string[] {
  return input.reduce<string[]>((prev, curr) => {
    if (!prev.includes(curr)) prev.push(curr)
    return prev
  }, [])
}

function getFreePort(): Promise<number> {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4')
    socket.bind(0, () => {
      const port = socket.address().port
      socket.close(() => resolve(port))
    })
  })
}

describe('dnssd', () => {
  let dnssd: DNSSD

  beforeEach(async () => {
    const port = await getFreePort()
    // use a local ip to avoid real mdns traffic
    dnssd = new DNSSD({ ip: '127.0.0.1', port, multicast: false })
  })

  afterEach(async () => {
    await dnssd.destroy()
  })

  // MARK: find
  describe('find', () => {
    it('should find published services', async () => {
      // Publish services
      const service1 = dnssd.publish({ name: 'Foo Bar', type: 'test', port: 3000 })
      const service2 = dnssd.publish({ name: 'Invalid 1', protocol: 'udp', type: 'test', port: 3000 })
      const service3 = dnssd.publish({ name: 'Invalid 2', type: 'test2', port: 3000 })
      const service4 = dnssd.publish({ name: 'Baz', type: 'test', port: 3000, txt: { foo: 'bar' } })

      // Start browser to find services
      let ups = 0

      const promise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Services not found in time')), 3000)

        dnssd.startBrowser({ filter: { protocol: 'tcp', type: 'test' } }, s => {
          if (s.name === 'Foo Bar') {
            expect(s.name).toBe('Foo Bar')
            expect(s.fqdn).toBe('Foo Bar._test._tcp.local')
            expect(s.txt).toEqual({})
            expect(s.rawTxt).toEqual([])
          } else {
            expect(s.name).toBe('Baz')
            expect(s.fqdn).toBe('Baz._test._tcp.local')
            expect(s.txt).toEqual({ foo: 'bar' })
            expect(s.rawTxt).toEqual([Buffer.from('666f6f3d626172', 'hex')])
          }
          expect(s.host).toBe(os.hostname())
          expect(s.port).toBe(3000)
          expect(s.type).toBe('test')
          expect(s.protocol).toBe('tcp')
          expect(s.referer.address).toBe('127.0.0.1')
          expect(s.referer.family).toBe('IPv4')
          expect(Number.isFinite(s.referer.port)).toBe(true)
          expect(Number.isFinite(s.referer.size)).toBe(true)
          expect(s.subtypes).toEqual([])
          expect(filterDuplicates(s.addresses.sort())).toEqual(getAddresses().sort())

          if (++ups === 2) {
            // Wait briefly to ensure invalid record doesn't appear
            setTimeout(() => {
              clearTimeout(timeout)
              resolve()
            }, 50)
          }
        })
      })

      // Wait for all services to be published
      await Promise.all([service1, service2, service3, service4])

      await promise
    })

    it('should find one service', async () => {
      // Publish an invalid service first
      const invalidService = dnssd.publish({
        name: 'Invalid',
        type: 'test2',
        port: 3000,
      })

      // Publish the target service
      const targetService = dnssd.publish({
        name: 'Callback',
        type: 'test',
        port: 3000,
      })

      // Wait for both services to be published
      await Promise.all([invalidService, targetService])

      // Test the findOne callback
      const s = await dnssd.findOne({ filter: { protocol: 'tcp', type: 'test' } }, 3000)

      expect(s?.name).toBe('Callback')
    })

    it('should find one and timeout', async () => {
      const s = await dnssd.findOne({ filter: { protocol: 'tcp', type: 'test' } }, 1000)
      expect(s).toBe(null)
    })
  })

  // MARK: filter
  describe('filter', () => {
    it('should find published services by protocol', async () => {
      const type = 'test1'
      const name = 'Foo'
      const port = 3000

      const protocols = ['tcp', 'udp'] as const
      const target = randomOne(protocols)
      await Promise.all(protocols.map(protocol => dnssd.publish({ protocol, type, name, port })))

      let ups = 0
      await new Promise<void>(resolve => {
        dnssd.startBrowser({ filter: { protocol: target, type } }, s => {
          expect(s.protocol).toBe(target)
          ups++
          setTimeout(resolve, 1000)
        })
      })

      expect(ups).toBe(1)
    })

    it('should find published services by type', async () => {
      const name = 'Foo'
      const port = 3000

      const types = ['type1', 'type2', 'type3'] as const
      const target = randomOne(types)
      await Promise.all(types.map(type => dnssd.publish({ type, name, port })))

      let ups = 0
      await new Promise<void>(resolve => {
        dnssd.startBrowser({ filter: { protocol: 'tcp', type: target } }, s => {
          expect(s.type).toBe(target)
          ups++
          setTimeout(resolve, 1000)
        })
      })

      expect(ups).toBe(1)
    })

    it('should find published services by name', async () => {
      const type = 'test'
      const port = 3000

      const names = ['name1', 'name2', 'name3'] as const
      const target = randomOne(names)
      await Promise.all(names.map(name => dnssd.publish({ type, name, port })))

      let ups = 0
      await new Promise<void>(resolve => {
        dnssd.startBrowser({ filter: { protocol: 'tcp', type, name: target } }, s => {
          expect(s.name).toBe(target)
          ups++
          setTimeout(resolve, 1000)
        })
      })

      expect(ups).toBe(1)
    })

    it('should find published services matching regex on name', async () => {
      const type = 'test'
      const port = 3000
      const protocol = 'tcp'

      const names = ['alpha-service', 'beta-service', 'gamma-worker']
      const regex = /-service$/

      await Promise.all(names.map(name => dnssd.publish({ type, name, port, protocol })))

      const matched: string[] = []

      await new Promise<void>(resolve => {
        dnssd.startBrowser({ filter: { type, protocol, name: regex } }, s => {
          matched.push(s.name)
          if (matched.length >= 2) {
            setTimeout(resolve, 500)
          }
        })
      })

      expect(matched).toHaveLength(2)
      expect(matched).toEqual(expect.arrayContaining(['alpha-service', 'beta-service']))
    })

    it('should find service with subtypes', async () => {
      const type = 'test'
      const port = 3000
      const protocol = 'tcp'

      await dnssd.publish({ name: 'Foo', type, port, protocol, subtypes: ['foo', 'bar'] })
      await dnssd.publish({ name: 'Baz', type, port, protocol, subtypes: ['baz'] })

      let ups = 0
      await new Promise<void>(resolve => {
        dnssd.startBrowser({ filter: { type, protocol, subtypes: ['foo'] } }, s => {
          expect(s.name).toBe('Foo')
          expect(s.subtypes).toEqual(['foo'])
          ups++
          setTimeout(resolve, 1000)
        })
      })

      expect(ups).toBe(1)
    })

    it('should find service with txt record', async () => {
      const type = 'test'
      const port = 3000
      const protocol = 'tcp'

      await Promise.all([
        dnssd.publish({ name: 'Foo', type, port, protocol, txt: { foo: 'bar', foo2: 'bar_a' } }),
        dnssd.publish({ name: 'Foo', type, port, protocol, txt: { foo: 'bar', foo2: 'bar_b' } }),
        dnssd.publish({ name: 'Baz', type, port, protocol, txt: { foo: 'bar' } }),
        dnssd.publish({ name: 'Baz', type, port, protocol, txt: { foo: 'bar', foo2: 'invalid' } }),
        dnssd.publish({ name: 'Baz', type, port, protocol, txt: { bar: 'foo' } }),
      ])

      let ups = 0
      await new Promise<void>(resolve => {
        dnssd.startBrowser({ filter: { type, protocol, txt: { foo: 'bar', foo2: /^bar_.+/ } } }, s => {
          expect(s.name.startsWith('Foo')).toBe(true)
          ups++
          setTimeout(resolve, 1000)
        })
      })

      expect(ups).toBe(2)
    }, 10000)

    it('should find service with wildcard', async () => {
      await dnssd.publish({ name: 'Foo', type: 'footype', port: 3000, subtypes: ['foo', 'bar'] })
      await dnssd.publish({ name: 'Baz', type: 'bartype', port: 3001, subtypes: ['baz'] })

      const discovered = new Set<string>()

      await new Promise<void>(resolve => {
        dnssd.startBrowser({}, s => {
          discovered.add(s.fqdn)
          if (discovered.size === 2) {
            setTimeout(resolve, 1000)
          }
        })
      })

      expect(discovered.has('Foo._footype._tcp.local')).toBe(true)
      expect(discovered.has('Baz._bartype._tcp.local')).toBe(true)
    })
  })

  // MARK: down
  describe('down', () => {
    it('should detect service down event', async () => {
      // Publish the service
      const service = await dnssd.publish({ name: 'Foo Bar', type: 'test', port: 3000 })

      // Set up the browser to find services
      return new Promise<void>((resolve, reject) => {
        const browser = dnssd.startBrowser({ filter: { protocol: 'tcp', type: 'test' } })
        let upEventFired = false

        const timeout = setTimeout(() => {
          reject(new Error('Test timeout'))
        }, 5000)

        browser.on('up', s => {
          try {
            expect(s.name).toBe('Foo Bar')
            upEventFired = true
            void service.stop() // Trigger the down event
          } catch (error) {
            clearTimeout(timeout)
            reject(error as Error)
          }
        })

        browser.on('down', s => {
          try {
            if (!upEventFired) {
              throw new Error('Down event fired before up event')
            }
            expect(s.name).toBe('Foo Bar')
            clearTimeout(timeout)
            resolve()
          } catch (error) {
            clearTimeout(timeout)
            reject(error as Error)
          }
        })
      })
    })

    it('should emit "down" after TTL expires', async () => {
      const ttlSeconds = 1

      const browser = dnssd.startBrowser({ filter: { type: 'test', protocol: 'tcp' } })

      let serviceDiscovered = false
      let serviceWentDown = false

      const promise = new Promise<void>(resolve => {
        browser.on('up', s => {
          if (s.name === 'TTLExpireTest') {
            serviceDiscovered = true
          }
        })

        browser.on('down', s => {
          if (s.name === 'TTLExpireTest') {
            serviceWentDown = true
            resolve()
          }
        })
      })

      await dnssd.publish({
        name: 'TTLExpireTest',
        type: 'test',
        port: 3000,
        ttl: ttlSeconds,
      })

      await promise

      expect(serviceDiscovered).toBe(true)
      expect(serviceWentDown).toBe(true)
    })
  })
})

export function randomOne<T>(choices: readonly T[]): T {
  return choices[Math.floor(Math.random() * choices.length)]!
}
