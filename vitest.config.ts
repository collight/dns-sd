// vitest.config.ts
import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config'

export default defineConfig(env => {
  return mergeConfig(viteConfig(env), {
    test: {
      globals: true,
      environment: 'node',
      include: ['tests/**/*.{test,spec}.{ts,tsx}'],
      coverage: {
        provider: 'v8', // or 'istanbul'
        reporter: ['text', 'json', 'html'], // Output formats
        include: ['src/**/*.{ts,js}'], // Files to include
        exclude: ['**/*.test.ts'], // Files to exclude
      },
    },
  })
})
