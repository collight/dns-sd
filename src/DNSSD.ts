import mDNS from 'multicast-dns'

import { Browser, BrowserOptions, DiscoveredService } from './browser'
import { Registry, Service, ServiceOptions } from './registry'
import { MDNSServer } from './utils'

// MARK: DNSSD
/**
 * High-level API for Multicast DNS Service Discovery and Advertisement.
 *
 * The `DNSSD` class provides convenient methods for:
 * - Publishing services to the local network
 * - Browsing and discovering services
 * - Unpublishing and cleaning up all registered services
 * - Managing underlying mDNS server lifecycle
 *
 * It wraps a lower-level `MDNSServer` and coordinates interactions with
 * the service `Registry` and service `Browser`.
 *
 * @example
 * const dnssd = new DNSSD()
 *
 * // Advertise a new service
 * dnssd.publish({ name: 'My Printer', type: 'printer', port: 9100 })
 *
 * // Discover services
 * dnssd.startBrowser({ type: 'printer' }, service => {
 *   console.log('Found service:', service)
 * })
 */
export class DNSSD {
  readonly server: MDNSServer
  readonly registry: Registry

  constructor(options: mDNS.Options = {}) {
    this.server = new MDNSServer(options)
    this.registry = new Registry(this.server)
  }

  // MARK: service
  /**
   * Creates a new service instance without publishing it to the network.
   *
   * @param options - Configuration options for the service.
   * @returns A new `Service` instance linked to this registry.
   */
  makeService(options: ServiceOptions): Service {
    return this.registry.makeService(options)
  }

  /**
   * Publishes a service to the network using the given options.
   *
   * @param options - Configuration options for the service.
   * @returns A promise that resolves with the published service.
   */
  async publish(options: ServiceOptions): Promise<Service> {
    return this.registry.publish(options)
  }

  /**
   * Unpublishes all services that were previously published.
   *
   * Sends goodbye messages and clears internal state.
   */
  async unpublishAll(): Promise<void> {
    await this.registry.unpublishAll()
  }

  // MARK: browser
  /**
   * Creates a new mDNS browser for discovering services on the network.
   *
   * @param options - Optional configuration for the browser.
   * @returns A new `Browser` instance.
   */
  makeBrowser(options?: BrowserOptions): Browser {
    return new Browser(this.server.mdns, options)
  }

  /**
   * Creates and starts a browser for discovering services, with an optional handler for discovered services.
   *
   * @param options - Optional configuration for the browser.
   * @param onServiceUp - Optional callback invoked when a service is discovered.
   * @returns A started `Browser` instance.
   */
  startBrowser(options?: BrowserOptions, onServiceUp?: (service: DiscoveredService) => void): Browser {
    const browser = this.makeBrowser(options)
    if (onServiceUp) {
      browser.on('up', onServiceUp)
    }
    browser.start()
    return browser
  }

  /**
   * Discovers a single service matching the provided criteria, with a timeout.
   *
   * Stops discovery after the first match or when the timeout is reached.
   *
   * @param options - Optional browser options to filter services.
   * @param timeoutMs - Maximum time in milliseconds to wait for a match.
   * @returns A promise that resolves with the discovered service or `null` if none found.
   */
  async findOne(options?: BrowserOptions, timeoutMs = 10000): Promise<DiscoveredService | null> {
    return new Promise(resolve => {
      const browser = new Browser(this.server.mdns, options)
      browser.start()

      let timer: NodeJS.Timeout | undefined = setTimeout(() => {
        browser.stop()
        resolve(null)
      }, timeoutMs)

      browser.once('up', service => {
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
        browser.stop()
        resolve(service)
      })
    })
  }

  // MARK: destroy
  /**
   * Destroys the DNSSD instance, stopping all services and shutting down the server.
   *
   * No further operations should be performed after destruction.
   */
  async destroy(): Promise<void> {
    return new Promise(resolve => {
      this.registry.destroy()
      this.server.mdns.destroy(resolve)
    })
  }
}
