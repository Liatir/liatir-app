import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Liatir Context',
  description: 'The project memory for Liatir — shared by everyone who works on it.',
  base: '/',

  themeConfig: {
    logo: { light: '/static/app-icon-white-bg-color.png', dark: '/static/app-icon-white-bg-color.png', alt: 'Liatir' },
    siteTitle: 'Liatir Context',
    search: { provider: 'local' },

    nav: [
      { text: 'Overview', link: '/' },
      { text: 'Architecture', link: '/truth/architecture' },
      { text: 'Current status', link: '/state/current' },
      { text: 'Testing', link: '/truth/testing/overview' },
      { text: 'API', link: '/truth/api/liatir-api' },
      { text: 'Beta readiness', link: '/state/roadmap/beta-readiness' },
      { text: 'Product plan', link: '/state/roadmap/scientific-ai-workbench' },
    ],

    sidebar: [
      {
        text: 'Liatir Context',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/' },
        ],
      },
      {
        // truth/ — stable: what is true about the system and how it is worked in.
        text: 'Truth',
        collapsed: false,
        items: [
          { text: 'Core principles', link: '/truth/architecture' },
          { text: 'Conventions', link: '/truth/conventions' },
          { text: 'Implementation architecture', link: '/truth/architecture/implementation' },
          { text: 'Component boxes', link: '/truth/architecture/component-boxes' },
          { text: 'Runtime Boxes explained', link: '/truth/architecture/runtime-box-system-explained' },
          { text: 'Scientific artifact contract', link: '/truth/architecture/scientific-artifact-contract' },
          { text: 'API Connector', link: '/truth/architecture/api-connector' },
          { text: 'Controlled local MCP', link: '/truth/architecture/mcp' },
          { text: 'window.Liatir', link: '/truth/api/liatir-api' },
          { text: 'Rust commands', link: '/truth/api/rust-commands' },
          { text: 'Predictive genomics', link: '/truth/ai/predictive-genomics' },
          { text: 'Single-cell foundation models', link: '/truth/ai/single-cell-foundation-models' },
          { text: 'Testing Liatir', link: '/truth/testing/overview' },
          { text: 'Working agreements for agents', link: '/truth/agents/' },
        ],
      },
      {
        // state/ — volatile: where the project is, and what is still live.
        text: 'State',
        collapsed: false,
        items: [
          { text: 'Current project status', link: '/state/current' },
          { text: 'Scientific AI workbench', link: '/state/roadmap/scientific-ai-workbench' },
          { text: 'Beta 1 readiness', link: '/state/roadmap/beta-readiness' },
          { text: 'AI batches', link: '/state/roadmap/ai-batches' },
          { text: 'Runtime Box CI foundation', link: '/state/roadmap/runtime-box-ci-foundation' },
          { text: 'Release gate: signed distribution', link: '/state/roadmap/release-signed-distribution' },
          { text: 'New AI models integration plan', link: '/state/roadmap/new-ai-models-integration-plan' },
          { text: 'Phase 3 implementation status', link: '/state/roadmap/phase3-implementation-status' },
          { text: 'Phase 3: Boltz-2 source review', link: '/state/roadmap/phase3-boltz-source-review' },
          { text: 'Phase 3: Protenix source review', link: '/state/roadmap/phase3-protenix-source-review' },
          { text: 'Native Tools bundled environment', link: '/state/roadmap/native-tools-bundled-environment' },
          { text: 'Native Tool support matrix', link: '/state/roadmap/native-tool-support' },
          { text: 'Single-cell RNA-seq vertical', link: '/state/roadmap/single-cell-rnaseq-vertical' },
          { text: 'SnpEff and SnpSift suite', link: '/state/roadmap/snpeff-snpsift-managed-suite' },
          { text: 'Quenta MVP', link: '/state/roadmap/quenta' },
        ],
      },
      {
        // decisions/ — append-only: what was decided, why, and what was rejected.
        text: 'Decisions',
        collapsed: false,
        items: [
          { text: 'About decisions', link: '/decisions/README' },
          { text: 'Runtime Box ownership boundary', link: '/decisions/runtime-box-ownership-boundary' },
          { text: 'Pixi relocation and activation', link: '/decisions/runtime-box-pixi-phase0-spike' },
        ],
      },
      {
        // history/ — archive: completed, closed or superseded operational context.
        text: 'History',
        collapsed: true,
        items: [
          { text: 'About history', link: '/history/README' },
          { text: 'Runtime Box production report', link: '/history/runtime-box-production-report' },
          { text: 'Runtime Box pixi migration', link: '/history/runtime-box-pixi-migration' },
          { text: 'Runtime Box model platform expansion', link: '/history/runtime-box-model-platform-expansion' },
          { text: 'Phase 0 check: Windows', link: '/history/runtime-box-pixi-phase0-windows-check' },
          { text: 'Phase 0 check: Linux', link: '/history/runtime-box-pixi-phase0-linux-check' },
          { text: 'macOS launcher check', link: '/history/runtime-box-pixi-macos-launcher-check' },
          { text: 'Scrollcase extraction', link: '/history/scrollcase-extraction-plan' },
          { text: 'Scrollcase P5 Liatir adoption', link: '/history/scrollcase-p5-liatir-adoption' },
          { text: 'Gate 6: Nextflow cross-platform', link: '/history/gate-6-nextflow-cross-platform' },
          { text: 'Gate 7: Beta 1 macOS', link: '/history/gate-7-beta1-macos' },
          { text: 'Gate 7: Beta 1 Windows and Linux', link: '/history/gate-7-beta1-windows-linux' },
          { text: 'Gate 8: MCP Windows and Linux', link: '/history/gate-8-mcp-windows-linux' },
          { text: 'Riallineamento del piano', link: '/history/riallineamento_del_piano_Scientific_AI_Workbench' },
        ],
      },
    ],

    socialLinks: [],

    footer: {
      message: 'Liatir project memory — internal.',
    },
  },
})
