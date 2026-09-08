import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { transform } from 'sucrase'

// Local throughput measurement of the actual pure engine, not a relevance benchmark.
const engineUrl = new URL('../../src/lib/shared/recommendation-engine.ts', import.meta.url)
const source = readFileSync(engineUrl, 'utf8')
const compiled = transform(source, { transforms: ['typescript', 'imports'] }).code
const module = { exports: {} }
new Function('module', 'exports', compiled)(module, module.exports)
const { rankRecommendations } = module.exports
const now = Date.UTC(2026, 8, 8)
const item = (id, prefix) => ({
  key: `${prefix}:${id}`, title: `Fixture ${id}`, provider: `catalog${id % 4}`, kind: id % 2 ? 'movie' : 'show',
  genres: [id % 16, (id + 3) % 16, (id + 7) % 16].map(n => `Genre ${n}`),
  tags: [id % 37, (id + 5) % 37].map(n => `Tag ${n}`),
  people: [`Person ${id % 50}`], quality: 0.75, votes: 1000,
})
const cases = []
for (const [candidateCount, seedCount, signalLimit] of [[100, 25], [300, 100], [1000, 300], [1000, 1000, 100]]) {
  const candidates = Array.from({ length: candidateCount }, (_, i) => item(i, 'candidate'))
  const signals = Array.from({ length: seedCount }, (_, i) => ({
    item: item(i, 'seed'), weight: i % 7 ? 1 : -1, at: now - (i % 365) * 86400000,
    priority: signalLimit ? 1 + i % 4 : undefined,
  }))
  for (let i = 0; i < 2; i++) rankRecommendations(candidates, signals, { now, limit: 60, signalLimit })
  const samples = []
  for (let i = 0; i < 9; i++) {
    const start = performance.now()
    rankRecommendations(candidates, signals, { now, limit: 60, signalLimit })
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  cases.push({ candidateCount, seedCount, signalLimit, resultLimit: 60, samples: samples.length,
    minMs: +samples[0].toFixed(2), medianMs: +samples[4].toFixed(2), maxMs: +samples[8].toFixed(2) })
}
const result = { measuredAt: new Date().toISOString(), runtime: process.version, platform: process.platform,
  architecture: process.arch, engineSha256: createHash('sha256').update(source).digest('hex'),
  interpretation: 'Synthetic Node elapsed time after warm-up; not Worker CPU, cold-start latency, production SLO, or recommendation quality.', cases }
writeFileSync(new URL(process.argv[2] ?? 'fixed-benchmark-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
