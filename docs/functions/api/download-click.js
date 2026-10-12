const BUTTONS = new Set(['macos-dmg', 'windows-store', 'linux-appimage', 'linux-deb', 'linux-rpm'])

function response(status, message = null, headers = {}) {
  return new Response(message, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return response(405, 'Method not allowed', { Allow: 'POST' })

  const url = new URL(request.url)
  if (request.headers.get('Origin') !== url.origin) return response(403, 'Forbidden')
  const button = url.searchParams.get('button')
  if (!BUTTONS.has(button)) return response(400, 'Unknown download button')
  // Preview deployments have no production binding, so they cannot inflate real counts.
  if (!env.DOWNLOAD_CLICKS) return response(503, 'Counter unavailable')

  try {
    await env.DOWNLOAD_CLICKS.prepare(`
      INSERT INTO download_clicks (day, button, clicks) VALUES (date('now'), ?, 1)
      ON CONFLICT (day, button) DO UPDATE SET clicks = clicks + 1
    `).bind(button).run()
    return response(204)
  } catch {
    console.error('Download click counter unavailable.')
    return response(503, 'Counter unavailable')
  }
}
