import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('accepts checkout line-ending changes while detecting changed Worker sources and migrations', () => {
  const root = mkdtempSync(join(tmpdir(), 'izumi-bundle-test-'))
  const write = (path: string, text: string) => {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  const inputs = {
    'src/lib/catalog/collections/model.ts': 'export const model = {}\n',
    'src/lib/catalog/collections/requests.ts': 'export const requests = []\n',
    'cloudflare-sync-worker/src/index.js': 'export default { fetch() {} }\n',
    'cloudflare-sync-worker/migrations/0001_initial.sql': 'CREATE TABLE records (id TEXT);\n',
    'cloudflare-sync-worker/package.json': '{"type":"module"}\n',
    'cloudflare-sync-worker/package-lock.json': '{}\n',
    'cloudflare-sync-worker/wrangler.jsonc': '{"name":"test"}\n',
    'scripts/build-cloudflare-direct-upload.mjs': readFileSync(new URL('./build-cloudflare-direct-upload.mjs', import.meta.url), 'utf8'),
  }
  const run = (...args: string[]) => spawnSync(process.execPath,
    ['scripts/build-cloudflare-direct-upload.mjs', ...args], { cwd: root, encoding: 'utf8' })
  try {
    for (const [path, text] of Object.entries(inputs)) write(path, text.replace(/\r\n/g, '\n'))
    mkdirSync(join(root, 'src-tauri/src'), { recursive: true })
    // Stand in for Wrangler so the test exercises the real bundle command without dependencies.
    write('cloudflare-sync-worker/node_modules/wrangler/bin/wrangler.js', `
      import { writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      writeFileSync(join(process.argv[process.argv.indexOf('--outdir') + 1], 'index.js'), '// bundled fixture\\n')
    `)
    const generated = run()
    expect(generated.status, generated.stderr).toBe(0)
    for (const [path, text] of Object.entries(inputs)) write(path, text.replace(/\r?\n/g, '\r\n'))
    const windowsCheckout = run('--check')
    expect(windowsCheckout.status, windowsCheckout.stderr).toBe(0)

    write('cloudflare-sync-worker/src/index.js', 'export default { changed: true }\n')
    expect(run('--check').status).toBe(1)
    expect(run().status).toBe(0)
    write('cloudflare-sync-worker/migrations/0002_extra.sql', 'ALTER TABLE records ADD COLUMN value TEXT;\n')
    expect(run('--check').status).toBe(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
