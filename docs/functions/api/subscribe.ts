// Cloudflare Pages Function — POST /api/subscribe
// Verifies a Cloudflare Turnstile token, then stores the email in a D1 database.
//
// Bindings (configure in Cloudflare Pages → Settings, or docs/wrangler.toml):
//   - DB                : D1 database binding (see docs/schema.sql)
//   - TURNSTILE_SECRET  : Turnstile secret key (set as an encrypted env var / secret)

interface Env {
  DB: D1Database
  TURNSTILE_SECRET: string
}

interface Body {
  email?: string
  turnstileToken?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  // ── Parse body ─────────────────────────────────────────────
  let body: Body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }

  const email = (body.email ?? '').trim().toLowerCase()
  const token = body.turnstileToken ?? ''

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ error: 'Please enter a valid email address.' }, 400)
  }
  if (!token) {
    return json({ error: 'Verification is required.' }, 400)
  }

  // ── Verify Turnstile ───────────────────────────────────────
  if (!env.TURNSTILE_SECRET) {
    return json({ error: 'Server is not configured.' }, 500)
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? ''
  const form = new FormData()
  form.append('secret', env.TURNSTILE_SECRET)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)

  let verified = false
  try {
    const verifyRes = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: form,
    })
    const outcome = (await verifyRes.json()) as { success?: boolean }
    verified = outcome.success === true
  } catch {
    return json({ error: 'Verification failed. Please try again.' }, 502)
  }

  if (!verified) {
    return json({ error: 'Verification failed. Please try again.' }, 403)
  }

  // ── Store in D1 (dedupe on unique email) ───────────────────
  const country = (request.headers.get('CF-IPCountry') ?? '').slice(0, 2)
  try {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO subscribers (email, source, country) VALUES (?, ?, ?)'
    )
      .bind(email, 'website', country || null)
      .run()
  } catch (e) {
    // Surface the real cause in the Pages function logs (`wrangler pages
    // deployment tail`) — usually a missing `subscribers` table or an
    // unbound DB. The user still sees a generic message.
    console.error('subscribe: D1 insert failed', e)
    return json({ error: 'Could not save your email. Please try again.' }, 500)
  }

  return json({ ok: true })
}
