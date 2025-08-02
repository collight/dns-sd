import { DNSSD, Service } from '../src'
import { delay, DemoSteps } from './DemoSteps'

const dnssd = new DNSSD()
let serviceA: Service | undefined
let serviceB: Service | undefined

void new DemoSteps()
  .step('Registering service: A', async () => {
    serviceA = await dnssd.publish({ name: 'Service A', type: 'http', port: 3000 })
  })
  .step('Finding one service', async () => {
    const service = await dnssd.findOne({ filter: { protocol: 'tcp', type: 'http' } }, 5000)
    if (service) {
      console.log(`✔ Found service: ${service.name}`)
    } else {
      console.log('✘ No service found within timeout')
    }
  })
  .step('Registering services: B and C', async () => {
    serviceB = await dnssd.publish({ name: 'Service B', type: 'http', port: 3001 })
    await dnssd.publish({ name: 'Service C', type: 'http', port: 3002 })
  })
  .step('Quick discovery', async () => {
    const browser = dnssd.startBrowser({ filter: { protocol: 'tcp', type: 'http' } }, service => {
      console.log(`✔ Found service: ${service.name}`)
    })
    await delay(1000)
    browser.stop()
    console.log('- Discovery stopped')
  })
  .step('Unpublishing service: B', async () => {
    await serviceB?.stop()
  })
  .step('Starting continuous discovery', () => {
    const browser = dnssd.startBrowser({ filter: { protocol: 'tcp', type: 'http' } }, service => {
      console.log(`↑ ${service.name} - ${service.fqdn}`)
    })

    browser.on('down', service => {
      console.log(`↓ ${service.name} - ${service.fqdn}`)
    })

    browser.on('update', service => {
      console.log(`↑ ${service.name} - ${service.fqdn} -> ${JSON.stringify(service.txt)}`)
    })
  })
  .step('Publishing service: D', async () => {
    await dnssd.publish({ name: 'Service D', type: 'http', port: 3003 })
  })
  .step('Duplicated service: C', async () => {
    await dnssd.publish({ name: 'Service C', type: 'http', port: 3002 })
  })
  .step('Unpublishing service: A', async () => {
    await serviceA?.stop()
  })
  .runForever('Running Browser...')

process.on('SIGINT', () => {
  console.log('\n[Exit] Cleaning up...')
  void dnssd.unpublishAll().then(() => {
    void dnssd.destroy().then(() => {
      console.log('🧹 Clean exit')
      process.exit(0)
    })
  })
})
