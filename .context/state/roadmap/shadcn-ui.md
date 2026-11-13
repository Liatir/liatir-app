# shadcn/ui across Liatir

Owner decision, 2026-11-12. Status: **planned, not started**. Order: finish the Quenta
presentation mode first (it uses shadcn already), then write the full plan for the
app, then migrate. The detailed plan does not exist yet; write it here before starting.

## Decisions

- **Stage pages (React, sandboxed frame): done.** The Stage kit
  (`frontend/stage-kit/`) ships shadcn/ui components, Liatir charts (Chart.js) and
  blocks with React and Tailwind's in-page compiler inside the presentation runtime.
  It first targeted Preact through `preact/compat`; the spike showed Radix's Slider
  thumb never appearing under it, so the owner switched the runtime to real React
  (2026-11-12). See the [Liatir 1.0 ledger](./liatir-1.0.md).
- **App (SvelteKit / Svelte 5):** shadcn-svelte (Svelte 5 + Tailwind 4, built on Bits
  UI), not shadcn/ui React. Both use the same Liatir design tokens, so the app and
  presentations look like one product.
- Rejected for presentations: Bootstrap (dated look), daisyUI (1.1 MB full CSS without
  a build step), Flowbite and Preline (vanilla JS that rewrites the DOM behind React),
  Shoelace / Web Awesome (fetches components at runtime; partly paid), ECharts and
  Plotly (1–1.3 MB and code generation the frame's policy forbids).

## Measured scope of the app migration (2026-11-12)

144 `.svelte` files (~30,000 lines); 30 base components in
`frontend/src/lib/components/ui/` (Button used in 65 files, Card in 45, Select in 21);
269 hand-written `<button>`, `<input>`, `<select>` tags; 385 `data-testid` hooks the
real-app tests rely on.

## Intended approach (to be expanded into the plan)

1. Replace the internals of the 30 base components with shadcn-svelte, keeping their
   names, props and test hooks, so pages change little and the look updates at once.
2. Convert the hand-written controls screen by screen.
3. Verify each step with `test:ui`, refreshed visual baselines and a visual review.
