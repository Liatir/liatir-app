/** Shared by the build and Pages middleware so both address the same Markdown file. */
export function markdownPathFor(pathname) {
  if (pathname === '/') return '/index.md'
  const route = pathname.replace(/\/$/, '')
  if (route.split('/').pop().includes('.')) return null
  return `${route}.md`
}
