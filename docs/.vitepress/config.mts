import { defineConfig } from 'vitepress'

export default defineConfig({
  markdown: {
    // Abilita il rendering delle equazioni matematiche
    math: true
  },
  title: 'Liatir',
  description: 'Local-first bioinformatics desktop app built on Rust and Tauri.',
  base: '/',

  // Generate links without the .html suffix (Cloudflare Pages serves clean URLs).
  cleanUrls: true,

  // Cloudflare deployment docs — kept in docs/ but not a published page.
  srcExclude: ['DEPLOY-cloudflare.md'],

  // Generate sitemap.xml at build time so search engines can crawl every page.
  // `hostname` must be the production domain — it prefixes every URL entry.
  sitemap: {
    hostname: 'https://liatir.com',
  },

  // Browser-tab favicon: mono-color logo mark. SVG first for crisp scaling,
  // PNG fallback for browsers without SVG-favicon support.
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/static/logos/svg/app-icon-mono.svg' }],
    ['link', { rel: 'icon', type: 'image/png', href: '/static/logos/png/app-icon-mono.png' }],

    ['script', { src: "https://platform-api.sharethis.com/js/sharethis.js", async: "true" }],
    // Google Analytics (GA4). Fires on every page load.
    ['script', { async: '', src: 'https://www.googletagmanager.com/gtag/js?id=G-JSH1W9TFP9' }],
    ['script', {}, `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-JSH1W9TFP9');
    `],
  ],

  themeConfig: {
    logo: {
      light: '/static/logos/svg/app-icon-mono.svg',
      dark: '/static/logos/svg/app-icon-mono.svg',
      alt: 'Liatir',
    },
    siteTitle: 'Liatir',
    search: { provider: 'local' },

    nav: [
      { text: 'Resources', items: [
        { text: 'Tools', link: '/tools/overview' },
        { text: 'AI Models', link: '/ai/guide' },
        { text: 'Plugins', link: '/plugins/overview' },
        { text: 'Pipelines', link: '/pipeline/overview' },
      ] },
      { text: 'Introduction', link: '/introduction/overview' },
      { text: 'Donate', link: '/donate' },
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
          { text: 'BWA-MEM', link: '/tools/bwa-mem' },
          { text: 'Minimap2', link: '/tools/minimap2' },
          { text: 'BCFtools stats', link: '/tools/bcftools' },
          { text: 'BCFtools filter', link: '/tools/bcftools-filter' },
          { text: 'SnpEff', link: '/tools/snpeff' },
        ],
      },
      {
        text: 'AI',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/ai/guide' },
          {
            text: 'AI Tools',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/ai/tools/overview' },
              { text: 'CellTypist Annotation', link: '/ai/tools/celltypist-annotation' },
              { text: 'Sequence Embedding', link: '/ai/tools/sequence-embedding' },
              { text: 'Single-cell Embedding', link: '/ai/tools/single-cell-embedding' },
              { text: 'Genomic Variant Effect', link: '/ai/tools/genomic-variant-effect' },
              { text: 'Regulatory Prediction', link: '/ai/tools/regulatory-prediction' },
              { text: 'Protein Structure Prediction', link: '/ai/tools/protein-structure-prediction' },
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
              { text: 'scGPT Whole-human', link: '/ai/models/bowang-scgpt-whole-human' },
              { text: 'Geneformer V1 10M', link: '/ai/models/ctheodoris-geneformer-v1-10m' },
              { text: 'UCE 4-layer', link: '/ai/models/snap-stanford-uce-4layer' },
              { text: 'scFoundation 100M', link: '/ai/models/biomap-scfoundation-100m' },
            ],
          },
        ],
      },
      {
        text: 'Visualization',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/visualization/overview' },
          { text: '3D Structure Viewer', link: '/visualization/structure-viewer' },
          { text: 'Genome Track Viewer', link: '/visualization/genome-track-viewer' },
          { text: 'Single-cell Viewer', link: '/visualization/single-cell-viewer' },
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
              { text: 'Get started', link: '/plugins/getting-started' },
              { text: 'Bundle format', link: '/plugins/format' },
              { text: 'API packages', link: '/plugins/api-packages' },
            ],
          },
          {
            text: 'API',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/plugins/api/overview' },
              {
                text: 'Plugin authoring',
                collapsed: true,
                items: [
                  { text: 'definePlugin', link: '/plugins/api/plugin/define-plugin' },
                  { text: 'field', link: '/plugins/api/plugin/field' },
                  { text: 'PluginContext', link: '/plugins/api/plugin/plugin-context' },
                  { text: 'Liatir Node bridge', link: '/plugins/api/plugin/node-bridge' },
                ],
              },
              {
                text: 'Root',
                collapsed: true,
                items: [
                  { text: 'Overview', link: '/plugins/api/root/overview' },
                  { text: 'openBrowser', link: '/plugins/api/root/open-browser' },
                  { text: 'invoke', link: '/plugins/api/root/invoke' },
                ],
              },
              {
                text: '.desktop',
                collapsed: true,
                items: [
                  { text: 'App', link: '/plugins/api/desktop/app' },
                  { text: 'Events', link: '/plugins/api/desktop/events' },
                  { text: 'File System', link: '/plugins/api/desktop/file-system' },
                  { text: 'Shortcuts', link: '/plugins/api/desktop/shortcuts' },
                  { text: 'Deeplinks', link: '/plugins/api/desktop/deep-links' },
                  { text: 'Notifications', link: '/plugins/api/desktop/notifications' },
                  { text: 'Files', link: '/plugins/api/desktop/files' },
                  { text: 'Drag and Drop', link: '/plugins/api/desktop/drag-and-drop' },
                  { text: 'Network', link: '/plugins/api/desktop/network' },
                  { text: 'Window', link: '/plugins/api/desktop/window' },
                  { text: 'Clipboard', link: '/plugins/api/desktop/clipboard' },
                  { text: 'Utilities', link: '/plugins/api/desktop/utilities' },
                ],
              },
              {
                text: '.pipeline',
                collapsed: true,
                items: [
                  { text: 'run', link: '/plugins/api/pipeline/run' },
                ],
              },
              {
                text: '.jobs',
                collapsed: true,
                items: [
                  { text: 'spawn', link: '/plugins/api/jobs/spawn' },
                  { text: 'status', link: '/plugins/api/jobs/status' },
                  { text: 'list', link: '/plugins/api/jobs/list' },
                  { text: 'kill', link: '/plugins/api/jobs/kill' },
                  { text: 'clearDone', link: '/plugins/api/jobs/clear-done' },
                ],
              },
              {
                text: '.deps',
                collapsed: true,
                items: [
                  { text: 'check', link: '/plugins/api/deps/check' },
                  { text: 'checkMany', link: '/plugins/api/deps/check-many' },
                ],
              },
              {
                text: '.qc',
                collapsed: true,
                items: [
                  { text: 'seqkit', link: '/plugins/api/qc/seqkit' },
                  { text: 'fastp', link: '/plugins/api/qc/fastp' },
                  { text: 'fastqc', link: '/plugins/api/qc/fastqc' },
                ],
              },
              {
                text: '.align',
                collapsed: true,
                items: [
                  { text: 'bwaMem', link: '/plugins/api/align/bwa-mem' },
                  { text: 'minimap2', link: '/plugins/api/align/minimap2' },
                  { text: 'flagstat', link: '/plugins/api/align/flagstat' },
                  { text: 'faidx', link: '/plugins/api/align/faidx' },
                ],
              },
              {
                text: '.variants',
                collapsed: true,
                items: [
                  { text: 'bcftoolsStats', link: '/plugins/api/variants/bcftools-stats' },
                  { text: 'bcftoolsFilter', link: '/plugins/api/variants/bcftools-filter' },
                  { text: 'snpeff', link: '/plugins/api/variants/snpeff' },
                ],
              },
              {
                text: '.ai',
                collapsed: true,
                items: [
                  { text: 'Overview', link: '/plugins/api/ai/overview' },
                ],
              },
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
      { text: 'Branding Assets', link: '/branding' },
      { text: 'Donate', link: '/donate' },
      { text: `</br></br>All rights reserved</br>© ${new Date().getFullYear()} <a href="https://liatir.com" target="_blank">Liatir</a>`},
    ],

    socialLinks: [],

    footer: {
      message: 'Liatir — powerful bioinformatics on your machine.<br></br>By using this app, you agree to our <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms of Service</a>.',
      copyright: `All rights reserved © ${new Date().getFullYear()}  <a href="https://liatir.com" target="_blank">Liatir</a>`,
    },
  },
})
