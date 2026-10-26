<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vitepress'

const route = useRoute()
const ready = ref(false)
const nativeShare = ref(false)
const busy = ref(false)
const message = ref('')
const label = computed(() => nativeShare.value ? 'Share this page' : 'Copy page link')
let messageTimer: ReturnType<typeof setTimeout> | undefined

function clearMessage() {
  clearTimeout(messageTimer)
  message.value = ''
}

onMounted(() => {
  nativeShare.value = typeof navigator.share === 'function'
  ready.value = true
})
watch(() => route.path, clearMessage)
onBeforeUnmount(clearMessage)

function say(text: string, url: string) {
  if (window.location.href !== url) return
  message.value = text
  messageTimer = setTimeout(clearMessage, 4000)
}

async function sharePage() {
  if (busy.value) return
  busy.value = true
  clearMessage()
  const url = window.location.href
  try {
    // Call directly from the click handler: the native sheet needs user activation.
    if (nativeShare.value) {
      await navigator.share({ title: document.title, url })
    } else {
      await navigator.clipboard.writeText(url)
      say('Link copied', url)
    }
  } catch (error) {
    if (!(nativeShare.value && error instanceof DOMException && error.name === 'AbortError')) {
      say(nativeShare.value
        ? 'Could not open sharing. Please try again.'
        : 'Could not copy the link. Copy it from the address bar.', url)
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="ready" class="share-control">
    <p v-show="message" class="share-status" role="status" aria-live="polite">{{ message }}</p>
    <button type="button" class="share-button" :title="label" :aria-label="label"
      :disabled="busy" :aria-busy="busy" @click="sharePage">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.share-control {
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.share-button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: var(--vp-c-brand-1);
  color: #fff;
  cursor: pointer;
  box-shadow: 0 2px 8px rgb(0 0 0 / 15%);
}

.share-button:hover { background: var(--vp-c-brand-2); }
.share-button:focus-visible { outline: 2px solid var(--vp-c-text-1); outline-offset: 3px; }
.share-button:disabled { cursor: progress; opacity: 0.65; }

.share-status {
  max-width: min(280px, calc(100vw - 32px));
  margin: 0;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-text-1);
  font-size: 13px;
  line-height: 1.5;
}
</style>
