import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import HomePage from './HomePage.vue'
import CookieBanner from './CookieBanner.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  // Wrap the default layout so the cookie banner is rendered on every page
  // via the persistent `layout-bottom` slot.
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'layout-bottom': () => h(CookieBanner),
    })
  },
  enhanceApp({ app }) {
    app.component('HomePage', HomePage)
  },
}
