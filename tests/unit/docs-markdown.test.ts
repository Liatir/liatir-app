import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PageData, SiteConfig } from 'vitepress'
import { describe, expect, it } from 'vitest'
import { addCanonical, toPlainMarkdown, writeLlmsFiles } from '../../docs/.vitepress/site-meta'
import { markdownPathFor } from '../../docs/markdown-path.mjs'
import { onRequest } from '../../docs/functions/_middleware.js'

describe('public documentation Markdown', () => {
  it('keeps every tab and code example while removing presentation and resolving links', () => {
    const example = '```html\n<Tab title="literal">\n<a href="/example">example</a>\n<style>literal code</style>\n```'
    const source = [
      '---', 'title: Test', '---', '# Test', '<Tabs>', '<Tab title="Node">',
      '[Related](../overview#usage)', example, '</Tab>', '<Tab title="Python">',
      '```python', 'print("example")', '```', '</Tab>', '</Tabs>',
      '<style>body { color: red; }</style>',
    ].join('\n')
    const markdown = toPlainMarkdown(source, 'plugins/api/test.md')
    expect(markdown).toContain('### Node')
    expect(markdown).toContain('### Python')
    expect(markdown).toContain('[Related](https://liatir.com/plugins/overview#usage)')
    expect(markdown).toContain(example)
    expect(markdown).toContain('print("example")')
    expect(markdown).not.toContain('body { color: red; }')
    expect(markdown).not.toContain('<Tabs>')
    expect(markdown).not.toContain('title: Test')
  })

  it('builds only published pages, including directory indexes and optional pages', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'liatir-docs-markdown-'))
    try {
      const srcDir = path.join(temp, 'src')
      const outDir = path.join(temp, 'out')
      fs.mkdirSync(path.join(srcDir, 'guides'), { recursive: true })
      fs.mkdirSync(outDir)
      fs.writeFileSync(path.join(srcDir, 'index.md'), '---\ntitle: Liatir\n---\n<HomePage />\n')
      fs.writeFileSync(path.join(srcDir, 'guides/index.md'), '# Guide\n\nRead this guide.\n')
      fs.writeFileSync(path.join(srcDir, 'privacy.md'), '# Privacy\n\nPrivacy terms.\n')
      fs.writeFileSync(path.join(srcDir, 'excluded.md'), '# Unpublished\n')
      fs.writeFileSync(path.join(srcDir, '404.md'), '# Not found\n')
      writeLlmsFiles({
        srcDir, outDir, pages: ['index.md', 'guides/index.md', 'privacy.md', '404.md'],
        site: { description: 'Liatir documentation' }, logger: { info() {} },
      } as unknown as SiteConfig)

      expect(fs.readFileSync(path.join(outDir, 'guides.md'), 'utf8')).toContain('source: https://liatir.com/guides/')
      expect(fs.readFileSync(path.join(outDir, 'privacy.md'), 'utf8')).toContain('Privacy terms.')
      expect(fs.readFileSync(path.join(outDir, 'index.md'), 'utf8')).toContain('/guides/')
      expect(fs.readFileSync(path.join(outDir, 'index.md'), 'utf8')).not.toContain('<HomePage')
      expect(fs.readFileSync(path.join(outDir, 'llms-full.txt'), 'utf8')).toContain('Read this guide.')
      expect(fs.existsSync(path.join(outDir, 'excluded.md'))).toBe(false)
      expect(fs.existsSync(path.join(outDir, '404.md'))).toBe(false)

      const page = { relativePath: 'guides/index.md', frontmatter: {} } as PageData
      addCanonical(page)
      expect(page.frontmatter.head).toContainEqual(['link', {
        rel: 'alternate', type: 'text/markdown', href: 'https://liatir.com/guides.md',
      }])
    } finally {
      fs.rmSync(temp, { recursive: true, force: true })
    }
  })
})

function context(pathname: string, {
  accept = 'text/html,*/*;q=0.8', method = 'GET', asset = '# Documentation\n',
  assetStatus = 200, assetType = 'text/markdown', pageType = 'text/html',
} = {}) {
  let nextCalls = 0
  let assetCalls = 0
  let fetchedPath = ''
  return {
    get calls() { return { nextCalls, assetCalls, fetchedPath } },
    request: new Request(`https://liatir.com${pathname}`, { method, headers: { Accept: accept } }),
    next: async () => {
      nextCalls++
      return new Response(method === 'HEAD' ? null : '<html>page</html>', {
        headers: { 'Content-Type': pageType, Vary: 'Origin' },
      })
    },
    env: { ASSETS: { fetch: async (url: string) => {
      assetCalls++
      fetchedPath = new URL(url).pathname
      return new Response(asset, { status: assetStatus, headers: { 'Content-Type': assetType } })
    } } },
  }
}

describe('documentation HTTP representations', () => {
  it('serves the generated path advertised in the HTML, and separates cached representations', async () => {
    const htmlContext = context('/guides/')
    const html = await onRequest(htmlContext)
    expect(await html.text()).toBe('<html>page</html>')
    expect(html.headers.get('Link')).toContain(`<https://liatir.com${markdownPathFor('/guides/')}>`)
    expect(html.headers.get('Vary')).toBe('Origin, Accept')
    expect(htmlContext.calls.assetCalls).toBe(0)

    const markdownContext = context('/guides/', { accept: 'text/markdown' })
    const markdown = await onRequest(markdownContext)
    expect(markdownContext.calls.fetchedPath).toBe('/guides.md')
    expect(markdownContext.calls.nextCalls).toBe(0)
    expect(await markdown.text()).toBe('# Documentation\n')
    expect(markdown.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(markdown.headers.get('Vary')).toBe('Accept')
    expect(markdown.headers.get('Link')).toContain('rel="canonical"')
  })

  it.each(['*/*', 'text/html,text/markdown;q=0'])('keeps HTML for %s', async (accept) => {
    const result = await onRequest(context('/tools/overview', { accept }))
    expect(result.headers.get('Content-Type')).toBe('text/html')
  })

  it.each([
    { assetStatus: 404 },
    { assetType: 'text/html', asset: '<html>fallback</html>' },
  ])('preserves HTML when the Markdown asset is missing', async (options) => {
    const result = await onRequest(context('/missing', { accept: 'text/markdown', ...options }))
    expect(result.headers.get('Content-Type')).toBe('text/html')
    expect(result.headers.get('Vary')).toContain('Accept')
  })

  it('leaves requests that do not read a page untouched', async () => {
    const requestContext = context('/tools/overview', { method: 'POST', accept: 'text/markdown', pageType: 'application/json' })
    const result = await onRequest(requestContext)
    expect(requestContext.calls.assetCalls).toBe(0)
    expect(requestContext.calls.nextCalls).toBe(1)
    expect(result.headers.get('Content-Type')).toBe('application/json')
    expect(result.headers.get('Link')).toBeNull()
    expect(result.headers.get('Vary')).toBe('Origin')
  })

  it('leaves static assets and directly requested Markdown HTML fallbacks untouched', async () => {
    for (const pathname of ['/static/logo.svg', '/missing.md']) {
      const result = await onRequest(context(pathname, { accept: 'text/markdown' }))
      expect(result.headers.get('Link')).toBeNull()
      expect(result.headers.get('Content-Type')).toBe('text/html')
    }
  })

  it('declares directly requested Markdown and returns an empty body for HEAD', async () => {
    const direct = await onRequest(context('/tools/overview.md', { pageType: 'text/plain' }))
    expect(direct.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    const head = await onRequest(context('/tools/overview', { method: 'HEAD', accept: 'text/markdown' }))
    expect(await head.text()).toBe('')
    expect(head.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
  })
})
