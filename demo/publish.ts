import os from 'os'
import { exit } from 'process'
import util from 'util'
import chalk from 'chalk'
import { program } from 'commander'

import { DNSSD, ServiceOptions } from '../src'

type CLIOptions = {
  verbose: boolean
  protocol: string
  type: string
  subtypes: string
  name: string
  host: string
  port: string
  txt: Record<string, string>
}

function collectKeyValue(value: string, previous: Record<string, string> = {}) {
  const [key, val] = value.split('=')
  if (key === undefined || val === undefined) {
    throw new Error(chalk.red(`❌ Invalid data format: "${value}". Use key=value`))
  }
  previous[key] = val
  return previous
}

// MARK: main
async function main() {
  program
    .name(chalk.blueBright('browser'))
    .description('📡 A DNSSD service publisher')
    .version('1.0.0')
    .option('-v, --verbose', 'Print verbose data')
    .option('-p, --protocol <type>', 'Service protocol (tcp or udp)', 'tcp')
    .option('-t, --type <type>', 'Service type', 'http')
    .option('-s, --subtypes <items>', 'Comma-separated list of subtypes', '')
    .option('-n, --name <name>', 'Service name', 'My Service')
    .option('--host <host>', 'Host address', os.hostname())
    .option('--port <port>', 'Service port', '8080')
    .option('--txt <key=value>', 'Pass TXT key=value pairs (can be used multiple times)', collectKeyValue)
    .parse(process.argv)

  // MARK: setup dnsdd
  const dnssd = new DNSSD({ ip: '224.0.0.251', port: 5353 })

  process.on('SIGINT', () => {
    void (async () => {
      console.log(chalk.yellow('\n⚙️ [Exit] Cleaning up resources...'))
      await dnssd.unpublishAll()
      await dnssd.destroy()
      console.log(chalk.green('✅ Clean exit. Goodbye!'))
      exit(0)
    })()
  })

  // MARK: parse options
  const opts = program.opts<CLIOptions>()

  const subtypes = opts.subtypes ? opts.subtypes.split(',').filter(s => s) : []

  if (opts.protocol !== 'tcp' && opts.protocol !== 'udp') {
    console.error(chalk.red('❌ Protocol must be either "tcp" or "udp"'))
    exit(1)
  }

  const port = parseInt(opts.port, 10)
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(chalk.red('❌ Port must be a number between 1 and 65535'))
    exit(1)
  }

  const options: ServiceOptions = {
    protocol: opts.protocol,
    type: opts.type,
    subtypes: subtypes,
    name: opts.name,
    port: port,
    host: opts.host,
    txt: opts.txt,
  }

  const indentedOpts = util
    .inspect(options, { colors: true, depth: null, compact: false })
    .split('\n')
    .map(line => '  ' + line)
    .join('\n')

  console.log(chalk.magenta('📥 Service options:\n'))
  console.log(indentedOpts)
  console.log()

  // MARK: publish service
  console.log(chalk.cyan(`🚀 Publishing service "${chalk.bold(opts.name)} ...`))
  console.log()

  const service = await dnssd.publish({
    protocol: opts.protocol,
    type: opts.type,
    subtypes: subtypes,
    name: opts.name,
    port: port,
    host: opts.host,
    txt: opts.txt,
  })

  // MARK: service details
  console.log(chalk.green('🎉 Service published successfully!'))
  console.log()

  // Pretty print the service object
  if (opts.verbose) {
    console.log(chalk.gray('📝 Service details:\n'))

    const inspected = util.inspect(service, { colors: true, depth: null, compact: false })
    const indented = inspected
      .split('\n')
      .map(line => '  ' + line)
      .join('\n')

    console.log(indented)
    console.log()
  }
}

main().catch((err: unknown) => {
  console.error(chalk.red('❌ Unhandled error:'), err instanceof Error ? err.message : err)
  exit(1)
})
