import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'

it('executes every native Cloudflare migration as intact SQL, including comments with semicolons', () => {
  const directory = new URL('../cloudflare-sync-worker/migrations/', import.meta.url)
  const sources = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
    .map(name => ({ name, sql: readFileSync(new URL(name, directory), 'utf8') }))
  const nativeDeployment = readFileSync(new URL('../src-tauri/src/cloudflare_deploy.rs', import.meta.url), 'utf8')
  for (const migration of sources) expect(nativeDeployment).toContain(`migrations/${migration.name}`)
  const database = new DatabaseSync(':memory:')
  try {
    for (const migration of sources) database.exec(migration.sql)
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name))
      .toEqual(expect.arrayContaining(['devices', 'records', 'companion_discovery', 'record_chunks', 'companion_client_links', 'companion_client_recovery']))
    expect(database.prepare('PRAGMA table_info(records)').all().map(row => row.name)).toContain('chunk_ids')
    const discovery = sources.find(source => source.name.startsWith('0005'))!
    expect(discovery.sql).toContain('record; all content')
    // Reproduce the original splitter's exact failure against SQLite.
    const fragment = discovery.sql.split(';').map(part => part.trim()).find(part => part.startsWith('all content'))!
    expect(() => database.exec(fragment)).toThrow(/near "all"/)
  } finally { database.close() }
})
