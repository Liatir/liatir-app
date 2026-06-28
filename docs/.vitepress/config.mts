import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Liatir',
  description: 'Local-first bioinformatics desktop app built on Rust and Tauri.',
  base: '/',

  themeConfig: {
    logo: { light: '/static/app-icon-white-bg-color.png', dark: '/static/app-icon-white-bg-color.png', alt: 'Liatir' },
    siteTitle: 'Liatir',

    nav: [
      { text: 'Introduction', link: '/introduction/overview' },
      { text: 'Data', link: '/data/overview' },
      { text: 'Tools', link: '/tools/overview' },
      { text: 'Plugins', link: '/plugins/overview' },
      { text: 'Pipeline', link: '/pipeline/overview' },
      { text: 'API', link: '/api/liatir-api' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        collapsed: false,
        items: [
          { text: 'What is Liatir', link: '/introduction/overview' },
          { text: 'Architecture', link: '/introduction/architecture' },
        ],
      },
      {
        text: 'Data',
        collapsed: false,
        items: [
          { text: 'Managing files', link: '/data/overview' },
        ],
      },
      {
        text: 'Tools',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/tools/overview' },
          { text: 'FastQC', link: '/tools/fastqc' },
          { text: 'fastp', link: '/tools/fastp' },
          { text: 'seqkit', link: '/tools/seqkit' },
          { text: 'Samtools flagstat', link: '/tools/samtools' },
          { text: 'Samtools faidx', link: '/tools/samtools-faidx' },
          { text: 'BCFtools stats', link: '/tools/bcftools' },
          { text: 'BCFtools filter', link: '/tools/bcftools-filter' },
          { text: 'SnpEff', link: '/tools/snpeff' },
        ],
      },
      {
        text: 'Plugins (.lia)',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/plugins/overview' },
          { text: 'Bundle format', link: '/plugins/format' },
          { text: 'liatir-cli', link: '/plugins/liatir-cli' },
        ],
      },
      {
        text: 'Pipeline',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/pipeline/overview' },
        ],
      },
      {
        text: 'API Reference',
        collapsed: false,
        items: [
          { text: 'window.Liatir', link: '/api/liatir-api' },
          { text: 'Rust commands', link: '/api/rust-commands' },
        ],
      },
    ],

    socialLinks: [],

    footer: {
      message: 'Liatir — local-first bioinformatics.',
    },
  },
})
