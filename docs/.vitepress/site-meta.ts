// Machine-facing site metadata: the canonical URL of every page, plus the
// llms.txt / llms-full.txt and per-page Markdown that AI assistants can read.
//
// Everything is derived from the Markdown actually being built, so adding,
// renaming or deleting a page updates the canonical tag, the sitemap and both
// llms files with no extra step. The two llms files are written straight into
// the build output by `buildEnd`, which runs for every `vitepress build` — that
// is what keeps them from ever going stale, unlike a committed copy.

import fs from 'node:fs'
import path from 'node:path'
import type { PageData, SiteConfig } from 'vitepress'
import { markdownPathFor } from '../markdown-path.mjs'

/** Production origin. Single copy: `sitemap.hostname` and canonical URLs both read it. */
export const HOSTNAME = 'https://liatir.com'

/**
 * `relativePath` → public URL. Mirrors exactly what VitePress writes into
 * sitemap.xml under `cleanUrls: true`: no `.html` suffix, and `index.md`
 * collapsing to its directory. If those ever disagree, the canonical tag would
 * point search engines at a URL the sitemap never lists.
 */
export function pageUrl(relativePath: string): string {
  const slug = relativePath.replace(/\.md$/, '').replace(/(^|\/)index$/, '$1')
  return `${HOSTNAME}/${slug}`
}

/**
 * Pins every page to its liatir.com URL. The site is also reachable on its
 * `*.pages.dev` deployment hostname, and a static robots.txt cannot tell the two
 * apart — the canonical tag is the only thing that stops that from reading as
 * duplicate content.
 */
export function addCanonical(pageData: PageData): void {
  if (pageData.isNotFound || !pageData.relativePath) return
  const head = (pageData.frontmatter.head ??= [])
  // A page may pin its own canonical; never add a second, competing one.
  const hasCanonical = head.some(
    ([tag, attrs]: [string, Record<string, string>?]) => tag === 'link' && attrs?.rel === 'canonical'
  )
  if (!hasCanonical) head.push(['link', { rel: 'canonical', href: pageUrl(pageData.relativePath) }])
  if (pageData.relativePath === '404.md') return
  head.push(['link', {
    rel: 'alternate',
    type: 'text/markdown',
    href: `${HOSTNAME}${markdownPathFor(new URL(pageUrl(pageData.relativePath)).pathname)}`,
  }])
}

// ── Index shape ──────────────────────────────────────────────────────────────

// Reading order of the llms.txt index. A page's top-level folder picks its
// section; a folder that is not listed here lands in `Other`, so a new area of
// the docs shows up in the index instead of silently disappearing from it.
const SECTIONS: Array<{ dir: string; title: string }> = [
  { dir: 'getting-started', title: 'Getting started' },
  { dir: 'introduction', title: 'Introduction' },
  { dir: 'data', title: 'Data' },
  { dir: 'tools', title: 'Tools' },
  { dir: 'ai', title: 'AI Models and AI Tools' },
  { dir: 'visualization', title: 'Visualization' },
  { dir: 'pipeline', title: 'Pipelines' },
  { dir: 'mcp', title: 'Local MCP' },
  { dir: 'plugins', title: 'Plugins (.lia)' },
]

const OTHER_SECTION = 'Other'
const OPTIONAL_SECTION = 'Optional'

// Legal and marketing pages. `Optional` is the llms.txt spec's marker for
// "safe to skip when short on context", which is exactly right for these: they
// belong in the index, but they are not product knowledge, so they are also the
// pages left out of llms-full.txt.
const OPTIONAL_PAGES = ['privacy.md', 'terms.md', 'donate.md', 'branding.md']

// The home page is a Vue component with no prose, and 404 is not a document.
const SKIPPED_PAGES = ['index.md', '404.md']

// Entry points first: a section's overview reads before the pages it introduces.
const LEAD_BASENAMES = ['install', 'overview', 'guide']

// ── Markdown reading ─────────────────────────────────────────────────────────

type DocPage = {
  relativePath: string
  url: string
  title: string
  description: string
  body: string
}

// Frontmatter here is flat `key: value`, so the full YAML parser VitePress uses
// internally is not worth reaching for. Only `title` and `description` are read.
function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) return { data: {}, body: raw }
  const data: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1)
    if (key) data[key] = value
  }
  return { data, body: raw.slice(match[0].length) }
}

function stripInlineMarkup(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  // Prefer ending on a sentence, but only if that keeps most of the budget.
  const sentence = head.lastIndexOf('. ')
  if (sentence > max * 0.5) return head.slice(0, sentence + 1).trim()
  return `${head.slice(0, head.lastIndexOf(' ')).trimEnd()}…`
}

/** First real prose paragraph — the fallback summary for pages without frontmatter. */
function firstParagraph(body: string): string {
  const collected: string[] = []
  for (const line of body.split(/\r?\n/)) {
    const text = line.trim()
    // Headings, containers, tables, code fences, components, images and list
    // markers all read badly as a one-line summary: skip them before the
    // paragraph starts, and treat them as its end once it has.
    const isProse = text !== '' && !/^(#|:::|\||```|<|!\[|[-*>]\s)/.test(text)
    if (isProse) {
      collected.push(text)
      continue
    }
    if (collected.length) break
  }
  return clip(stripInlineMarkup(collected.join(' ')), 200)
}

function readPage(srcDir: string, relativePath: string): DocPage {
  const raw = fs.readFileSync(path.join(srcDir, relativePath), 'utf8')
  const { data } = parseFrontmatter(raw)
  const body = toPlainMarkdown(raw, relativePath)
  const h1 = /^#\s+(.*)$/m.exec(body)
  return {
    relativePath,
    url: pageUrl(relativePath),
    title: data.title || h1?.[1].trim() || path.basename(relativePath, '.md'),
    description: data.description || firstParagraph(body),
    // Drop the leading H1: the title is emitted separately by both writers.
    body: (h1 ? body.replace(h1[0], '') : body).trim(),
  }
}

/** Flatten presentation outside code fences; examples must survive byte for byte. */
export function toPlainMarkdown(source: string, relativePath: string): string {
  const { body } = parseFrontmatter(source)
  const sourceUrl = `${HOSTNAME}/${relativePath}`
  const flatten = (text: string) => text
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/^[ \t]*<HomePage\b[^>]*\/?>[ \t]*$/gim, '')
    .replace(/^[ \t]*<\/?Tabs\b[^>]*>[ \t]*$/gim, '')
    .replace(/^[ \t]*<Tab\s+title="([^"]*)"[^>]*>[ \t]*$/gim, '### $1')
    .replace(/^[ \t]*<\/Tab>[ \t]*$/gim, '')
    .replace(/<PatreonButton\s*\/>/g, '[Support Liatir on Patreon](https://www.patreon.com/16427094/join)')
    .replace(/<iframe\b[^>]*\bsrc=['"]([^'"]+)['"][^>]*>\s*<\/iframe>/gi, '[Support Liatir]($1)')
    .replace(/\]\(([^\s)]+)(\s+"[^"]*")?\)/g, (match, target, title = '') => {
      if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) return match
      return `](${new URL(target, sourceUrl).href}${title})`
    })
    .replace(/\b(href|src)=(['"])(\/[^'"]*)\2/g, '$1=$2' + HOSTNAME + '$3$2')
    .replace(/<\/?(?:div|span|center|small|figure)\b[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')

  const parts: string[] = []
  let prose = ''
  let fence = ''
  for (const line of body.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      parts.push(line)
      if (marker?.[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = ''
    } else if (marker) {
      parts.push(flatten(prose), line)
      prose = ''
      fence = marker
    } else {
      prose += line
    }
  }
  parts.push(flatten(prose))
  return parts.join('').trim()
}

function sectionOf(relativePath: string): string {
  if (OPTIONAL_PAGES.includes(relativePath)) return OPTIONAL_SECTION
  const dir = relativePath.includes('/') ? relativePath.split('/')[0] : ''
  return SECTIONS.find((section) => section.dir === dir)?.title ?? OTHER_SECTION
}

function orderKey(relativePath: string): [number, number, string] {
  const lead = LEAD_BASENAMES.indexOf(path.basename(relativePath, '.md'))
  return [
    lead === -1 ? LEAD_BASENAMES.length : lead,
    relativePath.split('/').length, // shallower pages before the ones nested under them
    relativePath,
  ]
}

/** Groups the built pages into the sections of the index, in reading order. */
function groupPages(srcDir: string, pages: string[]): Array<{ title: string; pages: DocPage[] }> {
  const grouped = new Map<string, DocPage[]>()
  const ordered = pages
    .filter((page) => !SKIPPED_PAGES.includes(page))
    .sort((a, b) => {
      const [x, y] = [orderKey(a), orderKey(b)]
      return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2])
    })

  for (const relativePath of ordered) {
    const section = sectionOf(relativePath)
    const bucket = grouped.get(section) ?? []
    bucket.push(readPage(srcDir, relativePath))
    grouped.set(section, bucket)
  }

  // Declared sections in order, then anything unclassified, with Optional last.
  const order = [...SECTIONS.map((section) => section.title), OTHER_SECTION, OPTIONAL_SECTION]
  return order
    .filter((title) => grouped.has(title))
    .map((title) => ({ title, pages: grouped.get(title)! }))
}

// ── Writers ──────────────────────────────────────────────────────────────────

function renderLlmsTxt(
  sections: Array<{ title: string; pages: DocPage[] }>,
  description: string,
  generatedAt: string
): string {
  const out = [
    '# Liatir',
    '',
    `> ${description}`,
    '',
    'Liatir is a desktop application for bioinformatics. Native tools, visual pipelines,',
    '`.lia` plugins and scientific AI Models all run on the user\'s own machine, and the',
    'app keeps working offline. The pages below are the product documentation.',
    '',
    `- Full text of every page in this index: ${HOSTNAME}/llms-full.txt`,
    `- Single-page Markdown: append .md to a page URL, for example ${HOSTNAME}/getting-started/install.md; or request the page with Accept: text/markdown.`,
    `- Chunked retrieval corpus (JSON): ${HOSTNAME}/quenta-docs.json`,
    `- Curated bioinformatics background (JSON): ${HOSTNAME}/quenta-knowledge.json`,
    `- Sitemap: ${HOSTNAME}/sitemap.xml`,
    `- Generated: ${generatedAt}`,
  ]

  for (const section of sections) {
    out.push('', `## ${section.title}`, '')
    for (const page of section.pages) {
      out.push(page.description ? `- [${page.title}](${page.url}): ${page.description}` : `- [${page.title}](${page.url})`)
    }
  }

  return `${out.join('\n')}\n`
}

function renderLlmsFullTxt(
  sections: Array<{ title: string; pages: DocPage[] }>,
  description: string,
  generatedAt: string
): string {
  const out = [
    '# Liatir — full documentation',
    '',
    `> ${description}`,
    '',
    `Every documentation page of ${HOSTNAME}, in full, as one document.`,
    `Index of the same pages: ${HOSTNAME}/llms.txt`,
    `Generated: ${generatedAt}`,
  ]

  for (const section of sections) {
    if (section.title === OPTIONAL_SECTION) continue
    for (const page of section.pages) {
      out.push('', '---', '', `# ${page.title}`, '', `Source: ${page.url}`, '', page.body)
    }
  }

  return `${out.join('\n')}\n`
}

/**
 * Writes llms.txt, llms-full.txt and each page's Markdown into the build output. Called from
 * `buildEnd`, once SSG has finished and `siteConfig.pages` is final.
 */
export function writeLlmsFiles(siteConfig: SiteConfig): void {
  const { srcDir, outDir, pages, site } = siteConfig
  const generatedAt = new Date().toISOString()
  const sections = groupPages(srcDir, pages)

  const index = renderLlmsTxt(sections, site.description, generatedAt)
  fs.writeFileSync(path.join(outDir, 'llms.txt'), index)
  fs.writeFileSync(path.join(outDir, 'llms-full.txt'), renderLlmsFullTxt(sections, site.description, generatedAt))

  for (const relativePath of pages.filter((page) => page !== '404.md')) {
    const page = readPage(srcDir, relativePath)
    const file = path.join(outDir, markdownPathFor(new URL(page.url).pathname)!.slice(1))
    const document = [
      '---',
      `title: ${JSON.stringify(page.title)}`,
      `description: ${JSON.stringify(page.description || site.description)}`,
      `source: ${page.url}`,
      '---',
      '',
      relativePath === 'index.md' ? index.trimEnd() : `# ${page.title}\n\n${page.body}`,
      '',
    ].join('\n')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, document)
  }

  const count = sections.reduce((total, section) => total + section.pages.length, 0)
  siteConfig.logger.info(`llms: llms.txt + llms-full.txt + page Markdown (${count} indexed pages, ${sections.length} sections)`)
}
