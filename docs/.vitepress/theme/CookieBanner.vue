<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { withBase } from 'vitepress'

// Key under which the acceptance flag is stored. Bump the suffix if the
// privacy terms change and consent needs to be re-collected.
const STORAGE_KEY = 'liatir-cookie-consent-v1'

// Hidden during SSR and until we can confirm (client-side) that consent
// hasn't already been given — this prevents a flash of the banner on every
// page load for visitors who already accepted.
const visible = ref(false)

onMounted(() => {
  // localStorage is client-only, so this check runs after hydration.
  try {
    if (localStorage.getItem(STORAGE_KEY) !== 'accepted') {
      visible.value = true
    }
  } catch {
    // Private-mode / storage-blocked browsers: show the banner anyway.
    visible.value = true
  }
})

function accept() {
  visible.value = false
  try {
    localStorage.setItem(STORAGE_KEY, 'accepted')
  } catch {
    // If storage is unavailable the banner may reappear next visit; that's
    // an acceptable fallback and nothing else should break.
  }
}
</script>

<template>
  <Transition name="cookie-fade">
    <div v-if="visible" class="cookie-banner" role="dialog" aria-live="polite"
      aria-label="Privacy notice">
      <p class="cookie-banner__text">
        We use only essential cookies to make this site work. By continuing to
        browse, you agree to our
        <a :href="withBase('/privacy')">Privacy Policy</a>.
      </p>
      <button class="cookie-banner__button" type="button" @click="accept">
        Got it
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.cookie-banner {
  position: fixed;
  bottom: 16px;
  left: 16px;
  right: 16px;
  z-index: 200;
  margin: 0 auto;
  max-width: 720px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-elv);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
}

.cookie-banner__text {
  margin: 0;
  flex: 1;
  font-size: 13px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

.cookie-banner__text a {
  color: var(--vp-c-brand-1);
  font-weight: 500;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.cookie-banner__button {
  flex-shrink: 0;
  padding: 8px 18px;
  border: 0;
  border-radius: 8px;
  background: var(--vp-c-brand-1);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.cookie-banner__button:hover {
  background: var(--vp-c-brand-2);
}

/* Enter/leave fade so the banner doesn't pop in abruptly. */
.cookie-fade-enter-active,
.cookie-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.cookie-fade-enter-from,
.cookie-fade-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

@media (max-width: 640px) {
  .cookie-banner {
    flex-direction: column;
    align-items: stretch;
    text-align: center;
    gap: 10px;
  }

  .cookie-banner__button {
    width: 100%;
    padding: 10px 18px;
  }
}
</style>
