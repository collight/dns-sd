import { exit } from 'process'
import util from 'util'
import chalk from 'chalk'
import { program } from 'commander'

import { BrowserFilter, DNSSD } from '../src'

interface CLIOptions {
  all: boolean
  verbose: boolean
  protocol: string
  type: string
  subtypes?: string
  name?: string
  txt?: Record<string, string>
}

// Parse TXT key=value pairs from CLI
function collectKeyValue(value: string, previous: Record<string, string> = {}) {
  const [key, val] = value.split('=')
  if (key == undefined || val === undefined) {
    throw new Error(chalk.red(`❌ Invalid TXT format: "${value}". Use key=value`))
  }
  previous[key] = val
  return previous
}

// MARK: main
async function main() {
  program
    .name(chalk.blue('dnssd-browser'))
    .description('🔍 Browse and watch DNS-SD services')
    .option('-a, --all', 'Search with wildcard (_services._dns-sd._udp.local)')
    .option('-v, --verbose', 'Print verbose data')
    .option('-p, --protocol <protocol>', 'Filter by protocol (tcp or udp)', 'tcp')
    .option('-t, --type <type>', 'Filter by service type', 'http')
    .option('-s, --subtypes <items>', 'Comma-separated list of subtypes')
    .option('-n, --name <name>', 'Filter by service name')
    .option('--txt <key=value>', 'Filter by TXT key=value pairs (can be used multiple times)', collectKeyValue)
    .parse(process.argv)

  // MARK: setup dnsdd
  const dnssd = new DNSSD({ ip: '224.0.0.251', port: 5353 })

  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n⚙️ [Exit] Cleaning up resources...'))
    void (async () => {
      await dnssd.unpublishAll()
      await dnssd.destroy()
      console.log(chalk.green('✅ Clean exit. Goodbye!'))
      exit(0)
    })()
  })

  // MARK: parse options
  const opts = program.opts<CLIOptions>()

  if (opts.protocol !== 'tcp' && opts.protocol !== 'udp') {
    console.error(chalk.red('❌ Protocol must be either "tcp" or "udp"'))
    exit(1)
  }

  const filter: BrowserFilter | undefined = opts.all
    ? undefined
    : {
        protocol: opts.protocol,
        type: opts.type,
        subtypes: opts.subtypes != undefined ? opts.subtypes.split(',').filter(Boolean) : [],
        name: opts.name,
        txt: opts.txt,
      }

  // MARK: start browser
  console.log(chalk.cyan('🔎 Starting browser with filter:\n'))
  console.log(
    util
      .inspect(filter, { colors: true, depth: null, compact: false })
      .split('\n')
      .map(line => '  ' + line)
      .join('\n'),
  )
  console.log()

  const browser = dnssd.makeBrowser({ filter })

  browser.on('up', service => {
    console.log(chalk.green(`⬆️  Service UP: ${chalk.bold(service.fqdn)}`))
    const { name, type, protocol, subtypes, host, port, addresses, referer, txt } = service

    if (opts.verbose) {
      // Pretty print main details
      console.log(
        util
          .inspect(
            { name, type, protocol, subtypes, host, port, addresses, referer },
            {
              colors: true,
              depth: null,
              compact: false,
            },
          )
          .split('\n')
          .map(line => '  ' + line)
          .join('\n'),
      )

      // Pretty print TXT records
      console.log(chalk.gray('  📝 TXT Records:'))
      console.log(
        util
          .inspect(txt, { colors: true, depth: null, compact: false })
          .split('\n')
          .map(line => '    ' + line)
          .join('\n'),
      )
      console.log()
    }
  })

  browser.on('down', service => {
    console.log(chalk.yellow(`⬇️  Service DOWN: ${chalk.bold(service.name)} - ${service.fqdn}\n`))
  })

  browser.on('update', service => {
    console.log(chalk.magenta(`🔄 Updated for ${chalk.bold(service.name)} - ${service.fqdn}`))
  })

  browser.start()
}

main().catch((err: unknown) => {
  console.error(chalk.red('❌ Unhandled error:'), err instanceof Error ? err.message : err)
  exit(1)
})
