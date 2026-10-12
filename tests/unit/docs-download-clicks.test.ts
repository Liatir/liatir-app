import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from '../../docs/functions/api/download-click.js'

function database() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(fs.readFileSync('docs/migrations/0001_download_clicks.sql', 'utf8'))
  return {
    sqlite,
    binding: { prepare: (sql: string) => ({ bind: (button: string) => ({
      run: async () => sqlite.prepare(sql).run(button),
    }) }) },
  }
}

function request(button = 'macos-dmg', method = 'POST', origin = 'https://liatir.com') {
  return new Request(`https://liatir.com/api/download-click?button=${encodeURIComponent(button)}`, {
    method, headers: { Origin: origin },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('download button counts', () => {
  it('atomically aggregates clicks by UTC day and button without visitor data', async () => {
    const { sqlite, binding } = database()
    try {
      const buttons = ['macos-dmg', 'windows-store', 'linux-appimage', 'linux-deb', 'linux-rpm']
      const responses = await Promise.all([...buttons, ...buttons].map((button) => onRequest({
        request: request(button), env: { DOWNLOAD_CLICKS: binding },
      })))
      expect(responses.every((response) => response.status === 204)).toBe(true)
      expect(responses[0].headers.get('Cache-Control')).toBe('no-store')
      expect(responses[0].headers.get('Set-Cookie')).toBeNull()
      const rows = sqlite.prepare('SELECT * FROM download_clicks ORDER BY button').all()
      expect(rows).toEqual([...buttons].sort().map((button) => ({
        day: new Date().toISOString().slice(0, 10), button, clicks: 2,
      })))
      expect(sqlite.prepare('PRAGMA table_info(download_clicks)').all().map((column) => column.name))
        .toEqual(['day', 'button', 'clicks'])
    } finally { sqlite.close() }
  })

  it.each(['GET', 'HEAD', 'OPTIONS'])('rejects %s without writing or exposing counts', async (method) => {
    const result = await onRequest({ request: request('macos-dmg', method), env: {} })
    expect(result.status).toBe(405)
    expect(result.headers.get('Allow')).toBe('POST')
  })

  it.each(['https://other.example', '', 'null'])('rejects foreign or absent origin %s', async (origin) => {
    const result = await onRequest({ request: request('macos-dmg', 'POST', origin), env: {} })
    expect(result.status).toBe(403)
  })

  it.each(['', 'other', "macos-dmg'); DROP TABLE download_clicks; --"])('rejects unknown button %s', async (button) => {
    const result = await onRequest({ request: request(button), env: {} })
    expect(result.status).toBe(400)
  })

  it('reports unavailable counters, including previews and database errors', async () => {
    expect((await onRequest({ request: request(), env: {} })).status).toBe(503)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await onRequest({ request: request(), env: {
      DOWNLOAD_CLICKS: { prepare: () => { throw new Error('Database unavailable') } },
    } })
    expect(result.status).toBe(503)
    expect(log).toHaveBeenCalledWith('Download click counter unavailable.')
  })
})
