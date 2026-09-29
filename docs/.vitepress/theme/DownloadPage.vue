<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

/** The public repository that carries only release downloads. */
const RELEASES_REPOSITORY = 'Liatir/liatir-releases'
const MICROSOFT_STORE_URL = 'https://apps.microsoft.com/detail/9NDBJVZJVV1Z'

type Platform = 'macos' | 'windows' | 'linux'
type Asset = { name: string; size: number; browser_download_url: string }

const version = ref<string | null>(null)
const assets = ref<Asset[]>([])
const failed = ref(false)
const detected = ref<Platform | null>(null)

/** The file a button downloads, found by what the release build names it rather than by version. */
function asset(suffix: string): Asset | undefined {
  return assets.value.find((candidate) => candidate.name.endsWith(suffix))
}

function megabytes(file: Asset | undefined): string {
  return file ? `${Math.round(file.size / 1_000_000)} MB` : ''
}

const mac = computed(() => asset('_aarch64.dmg'))
const linux = computed(() => [
  { label: 'AppImage', note: 'Any distribution', file: asset('.AppImage') },
  { label: '.deb', note: 'Debian, Ubuntu', file: asset('.deb') },
  { label: '.rpm', note: 'Fedora, openSUSE', file: asset('.rpm') },
])

function detectPlatform(): Platform | null {
  const agent = navigator.userAgent
  if (/Windows/i.test(agent)) return 'windows'
  if (/Mac OS X|Macintosh/i.test(agent) && !/iPhone|iPad/i.test(agent)) return 'macos'
  if (/Linux/i.test(agent) && !/Android/i.test(agent)) return 'linux'
  return null
}

onMounted(async () => {
  detected.value = detectPlatform()
  try {
    // The latest release is read at visit time, so a new version needs no site deploy.
    const response = await fetch(`https://api.github.com/repos/${RELEASES_REPOSITORY}/releases/latest`)
    if (!response.ok) throw new Error(String(response.status))
    const release = await response.json()
    version.value = String(release.tag_name).replace(/^v/, '')
    assets.value = release.assets
  } catch {
    failed.value = true
  }
})
</script>

<template>
  <div class="download">
    <header class="intro">
      <h1>Download Liatir</h1>
      <p>
        Free for macOS, Windows and Linux.
        <span v-if="version" class="version">Version {{ version }}</span>
      </p>
    </header>

    <p v-if="failed" class="notice" role="alert">
      The download list could not be loaded. Try again in a moment, or open the
      <a :href="`https://github.com/${RELEASES_REPOSITORY}/releases/latest`">latest release</a>.
    </p>

    <div class="platforms">
      <section class="platform" :class="{ current: detected === 'macos' }">
        <span v-if="detected === 'macos'" class="badge">Your computer</span>
        <h2>macOS</h2>
        <p class="requirement">Apple silicon (M1 or newer)</p>
        <a
          class="btn btn-brand"
          :class="{ disabled: !mac }"
          :href="mac?.browser_download_url"
          :aria-disabled="!mac"
        >Download for Mac</a>
        <p class="meta">{{ mac ? `.dmg · ${megabytes(mac)}` : ' ' }}</p>
      </section>

      <section class="platform" :class="{ current: detected === 'windows' }">
        <span v-if="detected === 'windows'" class="badge">Your computer</span>
        <h2>Windows</h2>
        <p class="requirement">Windows 10 or 11, 64-bit</p>
        <a
          class="btn btn-brand"
          :href="MICROSOFT_STORE_URL"
          target="_blank"
          rel="noopener"
        >Get it from Microsoft Store</a>
        <p class="meta">Installs and updates through the Store</p>
      </section>

      <section class="platform" :class="{ current: detected === 'linux' }">
        <span v-if="detected === 'linux'" class="badge">Your computer</span>
        <h2>Linux</h2>
        <p class="requirement">x86_64</p>
        <div class="linux">
          <a
            v-for="(option, index) in linux"
            :key="option.label"
            class="btn"
            :class="[index === 0 ? 'btn-brand' : 'btn-alt', { disabled: !option.file }]"
            :href="option.file?.browser_download_url"
            :aria-disabled="!option.file"
          >
            <span>{{ option.label }}</span>
            <small>{{ option.note }}{{ option.file ? ` · ${megabytes(option.file)}` : '' }}</small>
          </a>
        </div>
      </section>
    </div>

    <p class="next">
      Installed? Follow the <a href="/getting-started/first-analysis">first analysis guide</a>.
      Details for each system are in <a href="/getting-started/install">Install Liatir</a>.
    </p>
  </div>
</template>

<style scoped>
.download {
  max-width: 1040px;
  margin: 0 auto;
  padding: 72px 24px 96px;
}

.intro {
  text-align: center;
  margin-bottom: 48px;
}

.intro h1 {
  margin: 0;
  font-size: clamp(2.2rem, 5vw, 3rem);
  font-weight: 750;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.intro p {
  margin: 16px 0 0;
  font-size: 1.1rem;
  color: var(--vp-c-text-2);
}

.version {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.platforms {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.platform {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 32px 24px 24px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  text-align: center;
}

.platform.current {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 1px var(--vp-c-brand-1);
}

.badge {
  position: absolute;
  top: -11px;
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 10px;
  border-radius: 4px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;
}

.platform h2 {
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 1.4rem;
  font-weight: 700;
}

.requirement {
  margin: 6px 0 24px;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}

.btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 10px 18px;
  border-radius: 6px;
  border: 1px solid transparent;
  font-weight: 600;
  font-size: 0.95rem;
  text-decoration: none;
  transition: background-color 0.2s, border-color 0.2s;
}

.btn small {
  font-weight: 400;
  font-size: 0.75rem;
  opacity: 0.8;
}

.btn-brand {
  background: var(--vp-c-brand-1);
  color: #fff;
}

/* The lighter brand tones are too pale for white text, so hover darkens the brand colour instead. */
.btn-brand:hover {
  background: color-mix(in srgb, var(--vp-c-brand-1) 85%, #000);
}

.btn-alt {
  border-color: var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}

.btn-alt:hover {
  border-color: var(--vp-c-brand-1);
}

.btn.disabled {
  opacity: 0.45;
  pointer-events: none;
}

.meta {
  margin: 10px 0 0;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
}

.linux {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.notice {
  margin: 0 auto 32px;
  max-width: 640px;
  padding: 12px 16px;
  border: 1px solid var(--vp-c-warning-2);
  border-radius: 6px;
  background: var(--vp-c-warning-soft);
  text-align: center;
}

.next {
  margin: 48px 0 0;
  text-align: center;
  color: var(--vp-c-text-2);
}

.next a,
.notice a {
  color: var(--vp-c-brand-1);
  font-weight: 500;
  text-decoration: underline;
  text-underline-offset: 2px;
}

@media (max-width: 860px) {
  .platforms {
    grid-template-columns: 1fr;
  }
}
</style>
