import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Liatir',
  description: 'Local-first bioinformatics desktop app built on Rust and Tauri.',
  base: '/',

  themeConfig: {
    logo: { light: '/static/app-icon-white-bg-color.png', dark: '/static/app-icon-white-bg-color.png', alt: 'Liatir' },
    siteTitle: 'Liatir',
    search: { provider: 'local' },

    nav: [
      { text: 'Introduction', link: '/introduction/overview' },
      { text: 'Data', link: '/data/overview' },
      { text: 'Tools', link: '/tools/overview' },
      { text: 'AI Models', link: '/ai/models/overview' },
      { text: 'Plugins', link: '/plugins/overview' },
      { text: 'Pipeline', link: '/pipeline/overview' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        collapsed: false,
        items: [
          { text: 'What is Liatir', link: '/introduction/overview' },
          { text: 'How Liatir Works', link: '/introduction/architecture' },
          { text: "Tauri", link: "/introduction/what-is-tauri" },
        ],
      },
      {
        text: 'Data',
        collapsed: true,
        items: [
          { text: 'Managing files', link: '/data/overview' },
        ],
      },
      {
        text: 'Tools',
        collapsed: true,
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
        text: 'AI Models',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/ai/models/overview' },
          { text: 'CellTypist Local Annotation', link: '/ai/models/celltypist-local-annotation' },
          { text: 'Nucleotide Transformer v2 50M', link: '/ai/models/instadeep-nt-v2-50m-multi-species' },
          { text: 'Nucleotide Transformer v2 500M', link: '/ai/models/instadeep-nt-v2-500m-multi-species' },
          { text: 'Enformer Regulatory Prediction', link: '/ai/models/deepmind-enformer-regulatory' },
          { text: 'Basenji2 Human Regulatory', link: '/ai/models/calico-basenji2-human-regulatory' },
          { text: 'Borzoi Mini K562 RNA-seq', link: '/ai/models/calico-borzoi-mini-k562-rna' },
          { text: 'ESM-2 8M Protein', link: '/ai/models/facebook-esm2-8m-protein' },
          { text: 'Boltz-2 Local Structure & Binding', link: '/ai/models/boltz2-local-structure-binding' },
          { text: 'Chai-1 Local Structure', link: '/ai/models/chai1-local-structure' },
        ],
      },
      {
        text: 'Pipelines',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/pipeline/overview' },
        ],
      },
      {
        text: 'Plugins (.lia)',
        items: [
      {
        text: 'Get started',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/plugins/overview' },
          { text: 'Bundle format', link: '/plugins/format' },
          { text: 'liatir-cli', link: '/plugins/liatir-cli' },
        ]},
      {
        text: "API",
        collapsed: true,
        items: [
          { text: "Overview", link: "/plugins/api/overview" },
          {
            text: ".desktop",
            collapsed: true,
            items: [
              { text: "App", link: "/plugins/api/desktop/app" },
              { text: "Events", link: "/plugins/api/desktop/events" },
              { text: "File System", link: "/plugins/api/desktop/file-system" },
              { text: "Shortcuts", link: "/plugins/api/desktop/shortcuts" },
              { text: "Deeplinks", link: "/plugins/api/desktop/deep-links" },
              { text: "Notifications", link: "/plugins/api/desktop/notifications" },
              { text: "Files", link: "/plugins/api/desktop/files" },
              { text: "Drag and Drop", link: "/plugins/api/desktop/drag-and-drop" },
              { text: "Network", link: "/plugins/api/desktop/network" },
              { text: "Window", link: "/plugins/api/desktop/window" },
              { text: "Clipboard", link: "/plugins/api/desktop/clipboard" },
              { text: "Utilities", link: "/plugins/api/desktop/utilities" }
            ],
          }
        ],
      },
        ],
      },
      {
        text: "Legal",
        items: [
          { text: "Privacy Policy", link: "/privacy" },
          { text: "Terms of Service", link: "/terms" }
        ]
      },
      { text: `</br>All rights reserved</br>© ${new Date().getFullYear()} <a href="/">Liatir</a>`},
    ],

    socialLinks: [],

    footer: {
      message: 'Liatir — local-first bioinformatics.',
    },
  },
})
