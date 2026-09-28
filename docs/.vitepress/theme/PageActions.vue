<script setup lang="ts">
import { useData } from 'vitepress'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const { page } = useData()
const PROMPT = 'Read this Liatir documentation page and help me with it: '
// These services own their prompt URL parameters. Copy prompt also supports any other model.
const SERVICES = [
  { label: 'Claude', url: 'https://claude.ai/new?q=' },
  { label: 'ChatGPT', url: 'https://chatgpt.com/?q=' },
  { label: 'Mistral', url: 'https://chat.mistral.ai/chat?q=' },
  { label: 'Perplexity', url: 'https://www.perplexity.ai/search?q=' },
]

// Reuse the build's discovery link, rather than derive the Markdown path again in the browser.
const twin = computed(() => page.value.frontmatter.head?.find(
  ([tag, attrs]: [string, Record<string, string>?]) => tag === 'link' && attrs?.rel === 'alternate' && attrs?.type === 'text/markdown'
)?.[1]?.href ?? '')
const local = computed(() => twin.value ? new URL(twin.value).pathname : '')
const services = computed(() => SERVICES.map((service) => ({
  ...service, href: service.url + encodeURIComponent(PROMPT + twin.value),
})))
const root = ref<HTMLElement | null>(null)
const markdownTrigger = ref<HTMLButtonElement | null>(null)
const aiTrigger = ref<HTMLButtonElement | null>(null)
const open = ref('')
const flash = ref<{ on: string; text: string } | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | undefined

watch(() => page.value.relativePath, () => {
  open.value = ''
  flash.value = null
  clearTimeout(flashTimer)
})

function onDocumentClick(event: MouseEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = ''
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value && root.value?.contains(document.activeElement)) {
    const trigger = open.value === 'markdown' ? markdownTrigger.value : aiTrigger.value
    open.value = ''
    trigger?.focus()
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  clearTimeout(flashTimer)
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})

function toggle(menu: string) {
  open.value = open.value === menu ? '' : menu
}

function say(on: string, text: string) {
  flash.value = { on, text }
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = null), 2000)
}

const labelOf = (menu: string, label: string) => flash.value?.on === menu ? flash.value.text : label

async function copyPage() {
  const url = local.value
  open.value = ''
  try {
    const response = await fetch(url)
    if (!response.ok || response.headers.get('Content-Type')?.includes('text/html')) throw new Error('Markdown unavailable')
    const markdown = await response.text()
    if (local.value !== url) return
    await navigator.clipboard.writeText(markdown)
    if (local.value === url) say('markdown', 'Copied')
  } catch {
    // Keep View available when clipboard access is refused; never pretend the copy succeeded.
    if (local.value === url) say('markdown', 'Copy failed')
  }
}

async function copyPrompt() {
  const url = twin.value
  open.value = ''
  try {
    await navigator.clipboard.writeText(PROMPT + url)
    if (twin.value === url) say('services', 'Copied')
  } catch {
    if (twin.value === url) say('services', 'Copy failed')
  }
}
</script>

<template>
  <div v-if="twin" ref="root" class="page-actions">
    <div class="page-actions-control">
      <button ref="markdownTrigger" type="button" class="page-actions-trigger"
        title="This page as Markdown" aria-controls="page-markdown-actions"
        :aria-expanded="open === 'markdown'" @click="toggle('markdown')">
        <span>{{ labelOf('markdown', 'Markdown') }}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 3.5 5 7.5 9 3.5" fill="none" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </button>
      <div v-if="open === 'markdown'" id="page-markdown-actions" class="page-actions-menu">
        <button type="button" class="page-actions-item" @click="copyPage">Copy</button>
        <a class="page-actions-item" :href="local" target="_blank" rel="noopener noreferrer">View</a>
      </div>
    </div>
    <div class="page-actions-control">
      <button ref="aiTrigger" type="button" class="page-actions-trigger"
        title="Ask an AI about this page" aria-controls="page-ai-actions"
        :aria-expanded="open === 'services'" @click="toggle('services')">
        <span>{{ labelOf('services', 'Ask an AI') }}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 3.5 5 7.5 9 3.5" fill="none" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </button>
      <div v-if="open === 'services'" id="page-ai-actions" class="page-actions-menu">
        <a v-for="service in services" :key="service.label" class="page-actions-item"
          :href="service.href" target="_blank" rel="noopener noreferrer">{{ service.label }}</a>
        <button type="button" class="page-actions-item is-separated" @click="copyPrompt">Copy prompt</button>
      </div>
    </div>
    <span class="sr-only" role="status">{{ flash?.text }}</span>
  </div>
</template>

<style scoped>
.page-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  min-height: 32px;
  margin-bottom: 12px;
}
.page-actions-control { position: relative; }
.page-actions-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 104px;
  padding: 7px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background-color: var(--vp-c-bg-alt);
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}
.page-actions-trigger span { flex: 1; text-align: left; }
.page-actions-trigger:hover, .page-actions-trigger[aria-expanded="true"] {
  color: var(--vp-c-text-1);
  background-color: var(--vp-c-bg);
}
.page-actions-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 10;
  min-width: 100%;
  padding: 6px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background-color: var(--vp-c-bg-elv);
  box-shadow: var(--vp-shadow-3);
}
.page-actions-item {
  display: block;
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.4;
  text-align: left;
  text-decoration: none;
  white-space: nowrap;
}
.page-actions-item:hover {
  color: var(--vp-c-text-1);
  background-color: var(--vp-c-bg-soft);
}
.page-actions-item.is-separated {
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--vp-c-divider);
}
.page-actions button:focus-visible, .page-actions a:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
