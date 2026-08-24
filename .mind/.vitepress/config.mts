import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Liatir Mind',
  description: 'The project memory for Liatir — shared by everyone who works on it.',
  base: '/',

  themeConfig: {
    logo: { light: '/static/app-icon-white-bg-color.png', dark: '/static/app-icon-white-bg-color.png', alt: 'Liatir' },
    siteTitle: 'Liatir Mind',
    search: { provider: 'local' },

    nav: [
      { text: 'Overview', link: '/' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'Testing', link: '/testing/overview' },
      { text: 'API', link: '/api/liatir-api' },
      { text: 'AI', link: '/ai/predictive-genomics' },
      { text: 'Beta readiness', link: '/roadmap/beta-readiness' },
      { text: 'Product plan', link: '/roadmap/scientific-ai-workbench' },
    ],

    sidebar: [
      {
        text: 'Liatir Mind',
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
          { text: 'Implementation architecture', link: '/architecture/implementation' },
          { text: 'Component boxes', link: '/architecture/component-boxes' },
          { text: 'Runtime Boxes explained', link: '/architecture/runtime-box-system-explained' },
          { text: 'Controlled local MCP', link: '/architecture/mcp' },
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
        text: 'AI',
        collapsed: false,
        items: [
          { text: 'Predictive genomics', link: '/ai/predictive-genomics' },
        ],
      },
      {
        text: 'API and Bridge',
        collapsed: false,
        items: [
          { text: 'window.Liatir', link: '/api/liatir-api' },
          { text: 'Rust commands', link: '/api/rust-commands' },
        ],
      },
      {
        text: 'Roadmap',
        collapsed: false,
        items: [
          { text: 'Scientific AI workbench', link: '/roadmap/scientific-ai-workbench' },
          { text: 'Beta 1 readiness', link: '/roadmap/beta-readiness' },
          { text: 'Release gate: signed distribution', link: '/roadmap/release-signed-distribution' },
          { text: 'Native Tools bundled environment', link: '/roadmap/native-tools-bundled-environment' },
          { text: 'Single-cell RNA-seq vertical', link: '/roadmap/single-cell-rnaseq-vertical' },
          { text: 'AI batches', link: '/roadmap/ai-batches' },
          { text: 'Runtime Box CI foundation', link: '/roadmap/runtime-box-ci-foundation' },
          { text: 'Runtime Box production report', link: '/roadmap/runtime-box-production-report' },
          { text: 'Runtime Box model platform expansion', link: '/roadmap/runtime-box-model-platform-expansion' },
          { text: 'Runtime Box pixi migration', link: '/roadmap/runtime-box-pixi-migration' },
        ],
      },
    ],

    socialLinks: [],

    footer: {
      message: 'Liatir project memory — internal.',
    },
  },
})
