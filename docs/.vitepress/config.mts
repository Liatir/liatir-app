import { defineConfig } from 'vitepress'
import { HOSTNAME, addCanonical, writeLlmsFiles } from './site-meta'

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
    hostname: HOSTNAME,
  },

  // The site answers on its Cloudflare Pages `*.pages.dev` hostname as well as on
  // liatir.com. robots.txt is a static file and cannot tell the two apart, so the
  // canonical tag is what keeps that from counting as duplicate content.
  transformPageData(pageData) {
    addCanonical(pageData)
  },

  // The AI index, full text and per-page Markdown, regenerated from the built pages.
  buildEnd(siteConfig) {
    writeLlmsFiles(siteConfig)
  },

  // Browser-tab favicon: logo mark. SVG first for crisp scaling,
  // PNG fallback (app icon on circle) for browsers without SVG-favicon support.
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/static/logo/svg/mono/color.svg' }],
    ['link', { rel: 'icon', type: 'image/png', href: '/static/icons/app-icons/standard/bg-rounded/x32.png' }],

    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap' }],

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
      light: '/static/icons/color.png',
      dark: '/static/icons/color.png',
      alt: 'Liatir Logo',
    },
    siteTitle: 'Liatir',
    search: { provider: 'local' },

    nav: [
      { text: 'Resources', items: [
        { text: 'Tools', link: '/tools/overview' },
        { text: 'AI Models', link: '/ai/guide' },
        { text: 'Plugins', link: '/plugins/overview' },
        { text: 'Pipelines', link: '/pipeline/overview' },
        { text: 'Local MCP', link: '/mcp/overview' },
        { text: 'Donate', link: '/donate' },
        { text: 'Brand assets', link: '/branding' },
      ] },
      { text: 'Get started', link: '/getting-started/install' },
      { text: 'Introduction', link: '/introduction/overview' },
      { text: 'Showcases', link: '/showcases/overview' },
      { text: 'Download', link: '/download' },
    ],

    sidebar: [
      {
        text: 'Get started',
        items: [
          { text: 'Install Liatir Beta', link: '/getting-started/install' },
          { text: 'First analysis', link: '/getting-started/first-analysis' },
          { text: 'Support and limitations', link: '/getting-started/support' },
        ],
      },
      {
        text: 'Introduction',
        items: [
          { text: 'What is Liatir', link: '/introduction/overview' },
          { text: 'How Liatir Works', link: '/introduction/architecture' },
        ],
      },
      {
        text: 'Showcases',
        collapsed: true,
        items: [
          { text: 'Scientific Showcases', link: '/showcases/overview' },
          { text: 'Single-cell foundation models vs established baselines', link: '/showcases/single-cell-foundation-benchmark' },
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
          { text: 'External Workflows', link: '/tools/external-workflows' },
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
          { text: 'Single-cell Reference Index', link: '/tools/single-cell-index' },
          { text: 'Single-cell Quantification', link: '/tools/single-cell-quant' },
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
              { text: 'Single-cell Embedding', link: '/ai/tools/single-cell-embedding' },
            ],
          },
          {
            text: 'AI Models',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/ai/models/overview' },
              { text: 'scGPT Whole-human', link: '/ai/models/bowang-scgpt-whole-human' },
              { text: 'Geneformer V1 10M', link: '/ai/models/ctheodoris-geneformer-v1-10m' },
              { text: 'UCE 4-layer', link: '/ai/models/snap-stanford-uce-4layer' },
              { text: 'Boltz-2', link: '/ai/models/jwohlwend-boltz-2' },
              { text: 'Protenix base v1.0.0', link: '/ai/models/bytedance-protenix-base-v1-0-0' },
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
        text: 'Local MCP',
        collapsed: true,
        items: [
          { text: 'Connect a client', link: '/mcp/overview' },
        ],
      },
      {
        text: 'Plugins (.lia)',
        items: [
              { text: 'Overview', link: '/plugins/overview' },
              { text: 'Get started', link: '/plugins/getting-started' },
              { text: 'Bundle format', link: '/plugins/format' },
          {
            text: 'API',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/plugins/api/overview' },
                  { text: 'Plugin context', link: '/plugins/plugin-context' },
                  { text: 'Define plugin', link: '/plugins/define-plugin' },
                  { text: 'Declare fields', link: '/plugins/field' },
              {
              text: '<span class="VPSidebarItem-monospace">Bridge</span>',
              items: [
                {
                  text: '.desktop',
                  collapsed: true,
                  items: [
                    { text: '.app', link: '/plugins/api/desktop/app' },
                    { text: '.fs', link: '/plugins/api/desktop/file-system'},
                  ],
                },
                {
                  text: '.jobs',
                  collapsed: true,
                  items: [
                    { text: '.status', link: '/plugins/api/jobs/status' },
                    { text: '.spawn', link: '/plugins/api/jobs/spawn' },
                    { text: '.kill', link: '/plugins/api/jobs/kill' },
                    { text: '.clearDone', link: '/plugins/api/jobs/clear-done' },
                    { text: '.list', link: '/plugins/api/jobs/list' },
                  ],
                  },
                  {
                    text: '.deps',
                    collapsed: true,
                    items: [
                      { text: '.check', link: '/plugins/api/deps/check' },
                      { text: '.checkMany', link: '/plugins/api/deps/check-many' },
                    ],
                  },
                  {
                    text: '.progress',
                    link: '/plugins/api/progress',
                  },
                  { text: '.log', link: '/plugins/api/log' },
                  { text: '.invoke', link: '/plugins/api/invoke' },
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
      { text: 'Brand Assets', link: '/branding' },
      { text: 'The name <i> Liatir </i>', link: '/introduction/the-name' },
      { text: 'Donate', link: '/donate' },
      { text: `</br></br>All rights reserved</br>© ${new Date().getFullYear()} <a href="https://liatir.com" target="_blank">Liatir</a>`},
    ],

    socialLinks: [
      {
        icon:"github",
        link: "https://github.com/Liatir/liatir-app"
      },
      {
      icon: "patreon",
      link: "https://www.patreon.com/16427094/join"
    }],

    footer: {
      message: 'Liatir — powerful bioinformatics on your machine.<br></br>By using this app, you agree to our <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms of Service</a>.',
      copyright: `All rights reserved © ${new Date().getFullYear()}  <a href="https://liatir.com" target="_blank">Liatir</a>`,
    },
  },
})
