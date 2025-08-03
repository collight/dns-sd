# dns-sd

[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/collight/dns-sd/publish-release.yml?style=flat-square)](https://github.com/collight/dns-sd/actions/workflows/publish-release.yml)
[![Bundlephobia](https://img.shields.io/bundlephobia/min/@collight/dns-sd?style=flat-square)](https://bundlephobia.com/package/@collight/dns-sd)
[![GitHub Release Date](https://img.shields.io/github/release-date/collight/dns-sd?style=flat-square)](https://github.com/collight/dns-sd/releases)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://github.com/collight/dns-sd?tab=License-1-ov-file#readme)
[![DeepScan grade](https://deepscan.io/api/teams/27688/projects/30090/branches/964215/badge/grade.svg)](https://deepscan.io/dashboard#view=project&tid=27688&pid=30090&bid=964215)

A DNS Service Discovery implementation in modern TypeScript

This is a rewrite of the [bonjour-service](https://github.com/onlxltd/bonjour-service) library that fixes multiple
issues and applies latest TypeScript best practice

## Installation

```bash
pnpm i @collight/dns-sd
```

## Usage

### Comprehensive demos

```bash
pnpm i

# demo/main.ts
pnpm demo

# demo/publish.ts
pnpm demo:publish

# demo/browse.ts
pnpm demo:browse
```

### Basic usage

```ts
import { dnssd } from '@collight/dns-sd'

const dnssd = new DNSSD()

// advertise an HTTP server on port 3000
dnssd.publish({ name: 'My Web Server', type: 'http', port: 3000 })

// browse for all http services
const browser = dnssd.startBrowser({ filter: { protocol: 'tcp', type: 'http' } }, s => {
  console.log('Found an HTTP server:', s)
})
```

### API Docs

https://collight.github.io/dns-sd/

## Development

```bash
pnpm i

pnpm format && pnpm lint

pnpm build && pnpm test

pnpm doc
```

## License

MIT
