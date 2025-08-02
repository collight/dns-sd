import dgram from 'dgram'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DNSSD, Service } from '../src'

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

  // MARK: publish
  describe('publish', () => {
    it('should publish a service', async () => {
      const service = dnssd.makeService({ name: 'foo', type: 'bar', port: 3000 })

      expect(service).toBeInstanceOf(Service)
      expect(service.published).toBe(false)

      await service.start()

      expect(service.published).toBe(true)
    })

    it('should publish multiple services in sequence', async () => {
      const services = [
        await dnssd.publish({ name: 'A', type: 'A', port: 3000 }),
        await dnssd.publish({ name: 'B', type: 'B', port: 3000 }),
        await dnssd.publish({ name: 'C', type: 'C', port: 3000 }),
      ]

      expect(services.every(s => s.published)).toBe(true)
    })

    it('should publish multiple services in parallel', async () => {
      const services = await Promise.all([
        dnssd.publish({ name: 'A', type: 'A', port: 3000 }),
        dnssd.publish({ name: 'B', type: 'B', port: 3000 }),
        dnssd.publish({ name: 'C', type: 'C', port: 3000 }),
      ])

      expect(services.every(s => s.published)).toBe(true)
    })
  })

  // MARK: unpublishAll
  describe('unpublishAll', () => {
    it('should unpublish all published services', async () => {
      const services = await Promise.all([
        dnssd.publish({ name: 'A', type: 'A', port: 3000 }),
        dnssd.publish({ name: 'B', type: 'B', port: 3000 }),
      ])

      expect(services.every(s => s.published)).toBe(true)

      await dnssd.unpublishAll()

      expect(services.every(s => s.published)).toBe(false)
    })

    it('should not fail when no services are published', async () => {
      await dnssd.unpublishAll()
    })
  })

  // MARK: edge cases
  describe('edge cases', () => {
    it('should publish service with custom TTL and TXT records', async () => {
      const service = await dnssd.publish({
        name: 'CustomTTL',
        type: 'http',
        port: 8080,
        ttl: 60, // 1 minute
        txt: { path: '/api', version: '1.0' },
      })

      expect(service.published).toBe(true)
      expect(service.ttl).toBe(60)
      expect(service.txt).toEqual({ path: '/api', version: '1.0' })
    })

    it('should perform probe and auto-resolve name conflicts', async () => {
      const service1 = await dnssd.publish({
        name: 'ConflictService',
        type: 'test',
        port: 1234,
        probe: true,
        probeAutoResolve: true,
      })

      expect(service1.published).toBe(true)

      const service2 = await dnssd.publish({
        name: 'ConflictService',
        type: 'test',
        port: 4321,
        probe: true,
        probeAutoResolve: true,
      })

      expect(service2.published).toBe(true)
      expect(service2.name).not.toBe(service1.name)
    })

    it('should throw error if port is invalid', async () => {
      await expect(() => dnssd.publish({ name: 'BadPort', type: 'http', port: -1 })).rejects.toThrow()

      await expect(() => dnssd.publish({ name: 'BadPort', type: 'http', port: 70000 })).rejects.toThrow()
    })

    it('should emit "up" and "down" events on service', async () => {
      const service = dnssd.makeService({ name: 'EventService', type: 'http', port: 3000 })

      const upSpy = vi.fn()
      const downSpy = vi.fn()

      service.on('up', upSpy)
      service.on('down', downSpy)

      await service.start()
      expect(upSpy).toHaveBeenCalledTimes(1)
      expect(service.published).toBe(true)

      await service.stop()
      expect(downSpy).toHaveBeenCalledTimes(1)
      expect(service.published).toBe(false)
    })
  })
})
