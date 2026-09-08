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
    database.exec(sources[0].sql)
    database.exec(`
      INSERT INTO metadata VALUES ('claimed', 'true');
      INSERT INTO devices VALUES ('existing-device', 'existing-token-hash', 'Existing device', 1, 1);
      INSERT INTO records VALUES ('watch', 'existing-device', 'encrypted-record', 1);
    `)
    for (const migration of sources.slice(1)) database.exec(migration.sql)
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name))
      .toEqual(expect.arrayContaining(['devices', 'records', 'companion_discovery', 'record_chunks', 'companion_client_links', 'companion_client_recovery']))
    expect(database.prepare('PRAGMA table_info(records)').all().map(row => row.name)).toContain('chunk_ids')
    expect(database.prepare("SELECT value FROM metadata WHERE key = 'claimed'").get()?.value).toBe('true')
    expect(database.prepare("SELECT token_hash FROM devices WHERE id = 'existing-device'").get()?.token_hash).toBe('existing-token-hash')
    expect(database.prepare("SELECT payload FROM records WHERE device_id = 'existing-device'").get()?.payload).toBe('encrypted-record')
    const discovery = sources.find(source => source.name.startsWith('0005'))!
    expect(discovery.sql).toContain('record; all content')
    // Reproduce the original splitter's exact failure against SQLite.
    const fragment = discovery.sql.split(';').map(part => part.trim()).find(part => part.startsWith('all content'))!
    expect(() => database.exec(fragment)).toThrow(/near "all"/)
  } finally { database.close() }
})
