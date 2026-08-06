---
title: Liatir Branding
description: Official Liatir brand assets, colors, and basic usage guidelines.
prev: false
next: 
  text: What is Liatir
  link: /introduction/overview
---

# Liatir Branding

Use these assets when referencing Liatir in articles, documentation, integrations, marketplace listings, launch pages, or community posts.

## Primary color

<div class="brand-color-card">
  <div class="brand-color-preview"></div>
  <div>
    <strong>#0A948B</strong>
    <button class="copy-button" onclick="navigator.clipboard.writeText('#0A948B').then(() => { const toast = document.querySelector('#primary-color-copied-toast'); toast.classList.add('is-visible'); clearTimeout(window.__liatirCopyToastTimer); window.__liatirCopyToastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1400); });">Copy</button>
    <span class="copy-toast" id="primary-color-copied-toast">Copied!</span>
  </div>
</div>

<div class="brand-card">

<details>

<summary> CSS Variables</summary>

---
```css
  --color-liatir: #0A948B;

  var(--color-liatir);
```
---
```css
  --color-liatir-2: #73C3BE;

  var(--color-liatir-2);
```
---
```css
  --color-liatir-3: #A4DAD5;

  var(--color-liatir-3);
```
---
```css
  --color-liatir-soft: rgba(10, 148, 139, 0.12);

  var(--color-liatir-soft);
```

</details>

</div>

## Logo assets

<div style="">

<span style="margin-right: 5px;"> **Downloads:** </span> <a href="https://liatir.com/static/liatir-logo-kit.zip" download="liatir-logo-kit.zip">Logo kit ↓</a> <span style="opacity: 0.3; margin-left: 3px; margin-right: 3px;"> | </span> <a href="https://liatir.com/static/logo/svg/standard/color.svg" download="liatir-logo.svg">SVG only ↓</a>

</div>

---

- Use the SVG logo when you need a scalable mark, favicon, or compact brand symbol.
- Use the PNG logo when you need the full Liatir logo in presentations, landing pages, product listings, or visual previews.

<div class="logo-card logo-card-icon">
  <img
    src="https://liatir.com/static/logo/svg/standard/color.svg"
    style="width: 70px;"
    alt="Liatir SVG icon"
  />
</div>

## Usage guidelines

When using the Liatir brand, please keep the logo readable, clear, and visually separated from surrounding elements.

<div class="guidelines-grid">
  <div class="guideline-card">
    <strong>Use enough spacing</strong>
    <span>Leave clear space around the logo so it does not feel cramped.</span>
  </div>

  <div class="guideline-card">
    <strong>Keep proportions</strong>
    <span>Do not stretch, squeeze, rotate, or distort the logo.</span>
  </div>

  <div class="guideline-card">
    <strong>Use the official color</strong>
    <span>Use <code>#0A948B</code> as the main accent color when referencing Liatir.</span>
  </div>

  <div class="guideline-card">
    <strong>Prefer contrast</strong>
    <span>Place the logo on backgrounds where it remains easy to read.</span>
  </div>
</div>

## Short description

You can use this short description when linking to Liatir:

<div class="brand-card">
  <div>
    <p>Liatir is a free desktop app that runs bioinformatics tools, AI models, custom plugins, and pipelines locally, keeping your data on your machine while delivering native performance, even with multi-gigabyte files.</p>
    <button class="copy-button" onclick="navigator.clipboard.writeText('Liatir is a free desktop app that runs bioinformatics tools, AI models, custom plugins, and pipelines locally, keeping your data on your machine while delivering native performance, even with multi-gigabyte files.').then(() => { const toast = document.querySelector('#short-description-copied-toast'); toast.classList.add('is-visible'); clearTimeout(window.__liatirCopyToastTimer); window.__liatirCopyToastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1400); });">Copy</button>
    <span class="copy-toast" id="short-description-copied-toast">Copied!</span>
  </div>
</div>

## Longer description

A more detailed version for product pages, forums, blog posts, directories, press kits, partner listings etc.

<div class="brand-card">
  <div>
    <p>Liatir is a free, local-first desktop app for bioinformatics analysis. It brings together tools such as FastQC, Samtools, BCFtools, fastp, and more, advanced AI models, and visual pipelines to connect multiple steps into reusable workflows, in one simple interface. You can also extend the app virtually without limits with your own custom plugins. Your data never leaves your machine while delivering native-speed performance, even on multi-gigabyte files.</p>
    <button class="copy-button" onclick="navigator.clipboard.writeText('Liatir is a free, local-first desktop app for bioinformatics analysis. It brings together tools such as FastQC, Samtools, BCFtools, fastp, and more, advanced AI models, and visual pipelines to connect multiple steps into reusable workflows, in one simple interface. You can also extend the app virtually without limits with your own custom plugins. Your data never leaves your machine while delivering native-speed performance, even on multi-gigabyte files.').then(() => { const toast = document.querySelector('#long-description-copied-toast'); toast.classList.add('is-visible'); clearTimeout(window.__liatirCopyToastTimer); window.__liatirCopyToastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1400); });">Copy</button>
    <span class="copy-toast" id="long-description-copied-toast">Copied!</span>
  </div>
</div>


## Embeddable badges

<br>

<a class="liatir-badge liatir-badge-dark" href="https://liatir.com" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:14px;padding:14px 18px;min-width:120px;border:1px solid rgba(255,255,255,0.06);border-radius:18px;background:#1f1f1f;color:#ffffff;text-decoration:none;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <span style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;background:transparent;overflow:hidden;">
    <img src="https://liatir.com/static/logo/svg/mono/color.svg" alt="Liatir" style="width:100%;height:100%;object-fit:contain;display:block;" />
  </span>
  <span style="display:flex;flex-direction:column;line-height:1.05;">
    <span style="color:rgba(255,255,255,0.68);font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.02em;">Get started with</span>
    <span style="margin-top:5px;color:#ffffff;font-size:18px;font-weight:800;letter-spacing:-0.03em;">Liatir</span>
  </span>
</a>

```html
<a class="liatir-badge liatir-badge-dark" href="https://liatir.com" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:14px;padding:14px 18px;min-width:120px;border:1px solid rgba(255,255,255,0.06);border-radius:18px;background:#1f1f1f;color:#ffffff;text-decoration:none;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <span style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;background:transparent;overflow:hidden;">
    <img src="https://liatir.com/static/logo/svg/mono/color.svg" alt="Liatir" style="width:100%;height:100%;object-fit:contain;display:block;" />
  </span>
  <span style="display:flex;flex-direction:column;line-height:1.05;">
    <span style="color:rgba(255,255,255,0.68);font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.02em;">Get started with</span>
    <span style="margin-top:5px;color:#ffffff;font-size:18px;font-weight:800;letter-spacing:-0.03em;">Liatir</span>
  </span>
</a>
```

---


<a class="liatir-badge liatir-badge-light" href="https://liatir.com" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:14px;padding:14px 18px;min-width:120px;border:1px solid rgba(0,0,0,0.05);border-radius:18px;background:#ffffff;color:#111111;text-decoration:none;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <span style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;background:transparent;overflow:hidden;">
    <img src="https://liatir.com/static/logo/svg/mono/color.svg" alt="Liatir" style="width:100%;height:100%;object-fit:contain;display:block;" />
  </span>
  <span style="display:flex;flex-direction:column;line-height:1.05;">
    <span style="color:rgba(0,0,0,0.52);font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.02em;">Get started with</span>
    <span style="margin-top:5px;color:#111111;font-size:18px;font-weight:800;letter-spacing:-0.03em;">Liatir</span>
  </span>
</a>

```html
<a class="liatir-badge liatir-badge-light" href="https://liatir.com" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:14px;padding:14px 18px;min-width:120px;border:1px solid rgba(0,0,0,0.05);border-radius:18px;background:#ffffff;color:#111111;text-decoration:none;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <span style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;background:transparent;overflow:hidden;">
    <img src="https://liatir.com/static/logo/svg/mono/color.svg" alt="Liatir" style="width:100%;height:100%;object-fit:contain;display:block;" />
  </span>
  <span style="display:flex;flex-direction:column;line-height:1.05;">
    <span style="color:rgba(0,0,0,0.52);font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.02em;">Get started with</span>
    <span style="margin-top:5px;color:#111111;font-size:18px;font-weight:800;letter-spacing:-0.03em;">Liatir</span>
  </span>
</a>
```

## Google Drive

Alternatively you can find Liatir branding assets and guidelines here: <br> [Liatir Google Drive shared folder ↗](https://drive.google.com/drive/folders/1Av46enrsxaBSE8XTayEz6oy766uv_BmG?usp=sharing)

## The name Liatir

Wondering what "Liatir" means? [Here's the story](/introduction/the-name).

<style>
.brand-color-card {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px;
  margin: 18px 0 28px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  position: relative;
}

.brand-card {
  display: flex;
  align-items: center;
  gap: 0px;
  padding: 18px;
  margin: 18px 0 18px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  position: relative;
}

.brand-color-preview {
  width: 72px;
  height: 72px;
  border-radius: 18px;
  background: var(--vp-c-brand-1);
}

.brand-color-card strong {
  display: block;
  font-size: 1.35rem;
  line-height: 1.2;
}

.brand-color-card span {
  display: block;
  margin-top: 4px;
  color: var(--vp-c-text-2);
}

.logo-card {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 18px 0;
  padding: 28px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  background:
    linear-gradient(45deg, rgba(125, 125, 125, 0.08) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(125, 125, 125, 0.08) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(125, 125, 125, 0.08) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(125, 125, 125, 0.08) 75%);
  background-size: 24px 24px;
  background-position: 0 0, 0 12px, 12px -12px, -12px 0;
}

.logo-card-icon img {
  width: 96px;
  height: 96px;
  object-fit: contain;
}

.logo-card-wide img {
  max-width: min(360px, 100%);
  height: auto;
  object-fit: contain;
}

.guidelines-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin: 20px 0 30px;
}

.guideline-card {
  padding: 18px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
}

.guideline-card strong {
  display: block;
  margin-bottom: 6px;
}

.guideline-card span {
  color: var(--vp-c-text-2);
}

.copy-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 10px;
  border-style: solid !important;
  border-radius: 10px;
  border-width: 1px;
  border-color: rgba(100,100,100,1);
  color: rgba(100,100,100,1);
  background: var(--vp-c-bg-soft);
  font-size: 9pt;
  font-weight: 500;
  cursor: pointer;
  opacity: 0.2;
  margin-top: 10px;
}

.brand-color-card:hover .copy-button {
  border-color: #0A948B !important;
  color: #0A948B !important;
  opacity: 1;
}

.copy-button:hover {
  border-color: #0A948B !important;
  color: #0A948B !important;
  opacity: 1;
}

.copy-toast {
  position: absolute;
  top: 14px;
  right: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 9px;
  border-radius: 999px;
  background: #0A948B;
  color: #fff !important;
  font-size: 9pt;
  font-weight: 500;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-4px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.copy-toast.is-visible {
  opacity: 1;
  transform: translateY(0);
}

.info {
padding-top: 5px !important;
padding-bottom: 5px !important;
}
.custom-block-title-default {
display: none !important;
}

#logo-downloads-table {
    width: 100% !important;
    margin-top: 20px;
    display: flex;
    justify-content: center !important;
    align-items: center !important;
    overflow: hidden !important;
}

#logo-downloads-table div {
    border-color: lightgray !important;
    border-width: 1px !important;
    border-style: solid !important;
    border-radius: 10px;
    overflow: hidden !important;
}

#logo-downloads-table table {
    border-radius: 10px !important;
    overflow: hidden !important;
    margin: -1px;
}

@media (max-width: 640px) {
  .brand-color-card {
    align-items: flex-start;
    flex-direction: column;
  }

  .guidelines-grid {
    grid-template-columns: 1fr;
  }
}
</style>
