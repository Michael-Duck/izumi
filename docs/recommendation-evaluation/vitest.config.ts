import { defineConfig } from 'vitest/config'
import base from '../../vitest.config.ts'

// The original audit criteria now also run in the normal CI suite as regressions.
export default defineConfig({
  resolve: base.resolve,
  test: {
    environment: 'node',
    include: ['src/lib/recommendations/watch-habits-regressions.test.ts', 'src/lib/companion/checkpoint-regressions.test.ts'],
    maxWorkers: 1,
  },
})
