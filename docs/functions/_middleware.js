import { markdownPathFor } from '../markdown-path.mjs'

const MARKDOWN_TYPE = 'text/markdown; charset=utf-8'

/** A browser's wildcard is not a request for Markdown, and q=0 is a refusal. */
export function prefersMarkdown(accept) {
  return (accept ?? '').split(',').some((entry) => {
    const [type, ...parameters] = entry.split(';').map((part) => part.trim().toLowerCase())
    const quality = parameters.find((parameter) => parameter.startsWith('q='))
    return type === 'text/markdown' && (!quality || Number(quality.slice(2)) > 0)
  })
}

function variesOnAccept(response) {
  if (!(response.headers.get('Vary') ?? '').split(',').some((value) => value.trim().toLowerCase() === 'accept')) {
    response.headers.append('Vary', 'Accept')
  }
  return response
}

export async function onRequest({ request, next, env }) {
  const url = new URL(request.url)
  // The waitlist API and non-reading requests must keep their own behavior.
  if (!['GET', 'HEAD'].includes(request.method) || /^\/api(?:\/|$)/.test(url.pathname)) return next()

  if (url.pathname.endsWith('.md')) {
    const asset = await next()
    // Pages can return an HTML fallback for a missing asset: never label that Markdown.
    if (!asset.ok || asset.headers.get('Content-Type')?.includes('text/html')) return asset
    const response = new Response(asset.body, asset)
    response.headers.set('Content-Type', MARKDOWN_TYPE)
    return response
  }

  const markdownPath = markdownPathFor(url.pathname)
  if (!markdownPath) return next()
  const markdownUrl = new URL(markdownPath, url.origin).href

  if (prefersMarkdown(request.headers.get('Accept'))) {
    const markdown = await env.ASSETS.fetch(markdownUrl)
    if (markdown.ok && !markdown.headers.get('Content-Type')?.includes('text/html')) {
      const body = await markdown.text()
      return new Response(request.method === 'HEAD' ? null : body, {
        headers: {
          'Content-Type': MARKDOWN_TYPE,
          Link: `<${url.origin}${url.pathname}>; rel="canonical"`,
          Vary: 'Accept',
          'x-markdown-tokens': String(Math.ceil(body.length / 4)),
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }
  }

  const page = await next()
  const response = variesOnAccept(new Response(page.body, page))
  if (page.ok && page.headers.get('Content-Type')?.includes('text/html')) {
    response.headers.append('Link', `<${markdownUrl}>; rel="alternate"; type="text/markdown"`)
  }
  return response
}
