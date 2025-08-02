import { RecordType } from 'dns-packet'
import { ResponsePacket } from 'multicast-dns'

import { debug, MDNSServer, nameEquals } from '../utils'
import { Service, ServiceOptions } from './Service'

// MARK: Registry
export class Registry {
  static MAX_PROBE_AUTO_RESOLVE_ATTEMPTS = 10
  static REANNOUNCE_MAX_MS: number = 60 * 60 * 1000
  static REANNOUNCE_FACTOR = 3

  private server: MDNSServer
  private startedServices: Service[] = []

  constructor(server: MDNSServer) {
    this.server = server
  }

  /**
   * Creates a new `Service` instance with the given options,
   * and links it to this registry.
   *
   * @param options - The configuration options for the service.
   * @returns A new `Service` instance.
   */
  makeService(options: ServiceOptions): Service {
    const service = new Service(options)
    service.registry = this
    return service
  }

  /**
   * Publishes a service to the network using the given options.
   * This includes optional probing and sending announcement packets.
   *
   * @param options - The configuration options for the service.
   * @returns A promise that resolves with the published `Service`.
   */
  async publish(options: ServiceOptions): Promise<Service> {
    const service = this.makeService(options)
    await service.start()
    return service
  }

  /**
   * Stops and unpublishes all currently running services.
   *
   * Sends goodbye messages and clears internal service state.
   */
  async unpublishAll() {
    await this.goodbye(this.startedServices).finally(() => {
      this.startedServices = []
    })
  }

  /**
   * Marks all services as destroyed without unpublishing them.
   *
   * Used when permanently shutting down the registry and disable future operations.
   */
  destroy() {
    for (const service of this.startedServices) {
      service.destroyed = true
    }
  }

  /**
   * Internal handler invoked when a service is started.
   *
   * This will initiate probing (if enabled) and trigger the initial announcement.
   *
   * @internal
   * @param service - The service being started.
   * @param options - Optional configuration to override probing behavior.
   */
  async onServiceStart(service: Service): Promise<void> {
    this.startedServices.push(service)

    if (service.probe) {
      if (service.probeAutoResolve) {
        // Auto-resolve conflicts by renaming service on probe conflict
        const originalName = service.name
        const fqdnSuffix = service.fqdn.substring(originalName.length)
        let attempt = 1

        while (attempt <= Registry.MAX_PROBE_AUTO_RESOLVE_ATTEMPTS) {
          const exists = await this.probe(service)
          if (!exists) break

          attempt++
          service.name = `${originalName} (${attempt})`
          service.fqdn = service.name + fqdnSuffix
        }

        if (attempt > Registry.MAX_PROBE_AUTO_RESOLVE_ATTEMPTS) {
          console.error(
            new Error(`Failed to resolve name conflicts after ${Registry.MAX_PROBE_AUTO_RESOLVE_ATTEMPTS} attempts.`),
          )
          void service.stop()
          return
        }
      } else {
        // Normal probe once, stop if conflict detected
        const exists = await this.probe(service)
        if (exists) {
          void service.stop()
          console.error(new Error('Service name is already in use on the network'))
          return
        }
      }
    }

    this.announce(service)
    return new Promise<void>(resolve => {
      service.on('up', resolve)
    })
  }

  /**
   * Internal handler invoked when a service is stopped.
   *
   * Sends goodbye messages and updates internal state.
   *
   * @internal
   * @param service - The service being stopped.
   */
  async onServiceStop(service: Service) {
    await this.goodbye([service]).finally(() => {
      const index = this.startedServices.indexOf(service)
      if (index !== -1) {
        this.startedServices.splice(index, 1)
      }
    })
  }

  // MARK: private
  /**
   * Probes the network to detect service name conflicts before announcing.
   *
   * Follows RFC 6762 §8.1–8.3 to ensure uniqueness by sending multiple queries
   * and listening for conflicting responses.
   *
   * @param service - The service to probe for potential name conflicts.
   */
  private async probe(service: Service): Promise<boolean> {
    let sent = false
    let retries = 0
    let timer: NodeJS.Timeout

    return new Promise(resolve => {
      const send = () => {
        // abort if the service have or is being stopped in the meantime
        if (!service.started || service.destroyed) {
          return
        }

        this.server.mdns.query(service.fqdn, 'ANY' as RecordType, error => {
          if (error) {
            console.warn('Error during probing:', error)
          }
          sent = true
          ++retries
          timer = setTimeout(retries < 3 ? send : done, 250).unref()
        })
      }

      const done = (exists = false) => {
        this.server.mdns.off('response', onresponse)
        clearTimeout(timer)
        resolve(exists)
      }

      const onresponse = (packet: ResponsePacket) => {
        /**
         * Apparently conflicting Multicast DNS responses received *before* the first probe packet is sent
         * MUST be silently ignored.
         *
         * @see {@link https://datatracker.ietf.org/doc/html/rfc6762#section-8.2 | Simultaneous Probe Tiebreaking}
         */
        if (!sent) {
          return
        }
        if (
          packet.answers.some(a => nameEquals(a.name, service.fqdn)) ||
          packet.additionals.some(a => nameEquals(a.name, service.fqdn))
        ) {
          done(true)
        }
      }

      this.server.mdns.on('response', onresponse)
      setTimeout(send, Math.random() * 250)
    })
  }

  /**
   * Announces a newly registered service to the network.
   *
   * Sends initial responses immediately, then exponentially spaced re-announcements
   * (3s, 9s, 27s...) up to one hour intervals per RFC 6762 §8.3.
   *
   * @param service - The service to announce.
   *
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6762#section-8.3 | Announcing}
   */
  private announce(service: Service) {
    const records = service.getRecords()

    this.server.register(records)

    let delay = 1000
    const broadcast = () => {
      if (!service.started || service.destroyed) return

      debug('mdns broadcast:', records)
      this.server.mdns.respond(records, error => {
        if (error) {
          console.warn('Error during announcement:', error)
        }

        if (!service.published) {
          service.published = true
          service.emit('up')
        }

        delay = delay * Registry.REANNOUNCE_FACTOR
        if (delay < Registry.REANNOUNCE_MAX_MS && !service.destroyed) {
          setTimeout(broadcast, delay).unref()
        }
      })
    }

    broadcast()
  }

  /**
   * Send goodbye messages for a list of services and unregistering them.
   *
   * Each record's TTL is set to 0 to indicate that the service is going offline.
   *
   * @param services - Array of services to remove from the network.
   *
   * @see {@link https://datatracker.ietf.org/doc/html/rfc6762#section-10.1 | Goodbye Packets}
   */
  private async goodbye(services: Service[]): Promise<void> {
    const publishedServices = services.filter(s => s.published)
    if (publishedServices.length === 0) {
      return
    }

    const records = publishedServices.flatMap(service => service.getRecords().map(record => ({ ...record, ttl: 0 })))
    if (records.length === 0) {
      return
    }

    this.server.unregister(records)

    return new Promise<void>((resolve, reject) => {
      debug('mdns goodbye:', records)
      this.server.mdns.respond(records, error => {
        for (const service of publishedServices) {
          service.published = false
          service.emit('down')
        }
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }
}
