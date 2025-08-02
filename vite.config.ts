// vite.config.ts
import fs from 'fs'
import { builtinModules } from 'module'
import path from 'path'
import { defineConfig, UserConfig } from 'vite'

import pkg from './package.json'

function getEntries(dir: string) {
  const entries: Record<string, string> = {}
  const tsRegex = /\.tsx?$/

  const files = fs.readdirSync(dir, { withFileTypes: true })
  for (const file of files) {
    const fullPath = path.resolve(dir, file.name)
    if (file.isDirectory()) {
      Object.assign(entries, getEntries(fullPath))
    } else if (file.isFile() && tsRegex.test(file.name)) {
      const key = path.relative('src', fullPath).replace(tsRegex, '')
      entries[key] = fullPath
    }
  }
  return entries
}

interface PackageJson {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function getExternal(pkg: PackageJson) {
  const externals = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]

  function getPkgNameRegex(pkgName: string) {
    const escaped = pkgName.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&')
    return new RegExp(`^${escaped}(\/.+)?$`)
  }

  return externals.map(getPkgNameRegex)
}

const srcPath = path.resolve(__dirname, 'src')
const distPath = path.resolve(__dirname, 'dist')

const entries = getEntries(path.resolve(__dirname, 'src'))
const external = [...getExternal(pkg), ...builtinModules]

console.log('src path', srcPath)

export default defineConfig((): UserConfig => {
  return {
    build: {
      outDir: distPath,
      emptyOutDir: true,
      target: 'es2020',

      minify: false,
      sourcemap: true,

      rollupOptions: {
        input: entries,
        external: external,
        preserveEntrySignatures: 'strict',
        output: [
          {
            format: 'es',
            dir: 'dist/esm',
            entryFileNames: '[name].js',
            chunkFileNames: '[name]-[hash].js',
            preserveModules: true,
            preserveModulesRoot: srcPath,
          },
          {
            format: 'cjs',
            dir: 'dist/cjs',
            entryFileNames: '[name].cjs',
            chunkFileNames: '[name]-[hash].cjs',
            preserveModules: true,
            preserveModulesRoot: srcPath,
          },
        ],
      },
    },
  }
})
