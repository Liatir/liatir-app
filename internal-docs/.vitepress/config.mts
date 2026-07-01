import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Liatir Internal',
  description: 'Private maintainer documentation for developing Liatir.',
  base: '/',

  themeConfig: {
    logo: { light: '/static/app-icon-white-bg-color.png', dark: '/static/app-icon-white-bg-color.png', alt: 'Liatir' },
    siteTitle: 'Liatir Internal',
    search: { provider: 'local' },

    nav: [
      { text: 'Overview', link: '/' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'Testing', link: '/testing/overview' },
      { text: 'AI Roadmap', link: '/roadmap/ai-batches' },
    ],

    sidebar: [
      {
        text: 'Maintainer Guide',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/' },
        ],
      },
      {
        text: 'Architecture',
        collapsed: false,
        items: [
          { text: 'Core principles', link: '/architecture/overview' },
        ],
      },
      {
        text: 'Testing',
        collapsed: false,
        items: [
          { text: 'Testing Liatir', link: '/testing/overview' },
        ],
      },
      {
        text: 'Roadmap',
        collapsed: false,
        items: [
          { text: 'AI batches', link: '/roadmap/ai-batches' },
        ],
      },
    ],

    socialLinks: [],

    footer: {
      message: 'Private Liatir maintainer documentation.',
    },
  },
})
