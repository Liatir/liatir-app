<script setup lang="ts">
import { withBase } from 'vitepress'
import HomeIcon from './HomeIcon.vue'
import HeroDna from './HeroDna.vue'
import {
  capabilities,
  heroHeadline,
  heroTagline,
  heroTrust,
  pillars,
  sectionHead,
} from './home-content'

import pkgJson from "../../../package.json";
</script>

<template>
  <div class="home">
    <!-- ── Hero ─────────────────────────────────────────────── -->
    <section class="hero">
      <HeroDna />

      <div class="container hero-inner">
        <div class="hero-copy">
          <div class="status-wrapper">
            <span class="status"><span class="status-dot" aria-hidden="true"></span><span><span style="text-transform: lowercase;">v</span>{{pkgJson.version}}</span> · <span>Open Source</span> · <a href="https://www.gnu.org/licenses/gpl-3.0" class="hover-underline" target="_blank">GNU GPL v3</a> <span class="status-github-separator" aria-hidden="true">·</span> <a href="https://github.com/Liatir/liatir-app" class="hover-underline status-github" target="_blank">GitHub</a></span>
          </div>

          <img class="hero-logo" :src="withBase('/static/logos/svg/logo-color.svg')" alt="" aria-hidden="true" />

          <h1 class="name">Liatir</h1>

          <p class="headline">
            <template v-for="(line, index) in heroHeadline" :key="line">
              <br v-if="index" />{{ line }}
            </template>
          </p>

          <p class="tagline">
            <template v-for="(line, index) in heroTagline" :key="line">
              <br v-if="index" />{{ line }}
            </template>
          </p>

          <div class="actions">
            <a class="btn btn-brand" :href="withBase('/download')">Download</a>
            <a class="btn btn-alt" :href="withBase('/introduction/overview')">Read the docs</a>
          </div>

          <div class="trust-metrics">
            <template v-for="(claim, index) in heroTrust" :key="claim">
              <!-- The middle claim is the one that goes when the row is too narrow for three. -->
              <div class="metric-divider" v-if="index" :class="{ 'hide-on-small-screens': index === 1 }"></div>
              <div class="metric" :class="{ 'hide-on-small-screens': index === 1 }">
                <span class="metric-val"></span>
                <span class="metric-label">{{ claim }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>

    </section>

    <!-- ── Pillars ──────────────────────────────────────────── -->
    <section class="container band">
      <div class="pillars">
        <article v-for="p in pillars" :key="p.title" class="card pillar">
          <span class="icon-chip"><HomeIcon :name="p.icon" /></span>
          <h3>{{ p.title }}</h3>
          <p>{{ p.text }}</p>
        </article>
      </div>
    </section>

    <!-- ── Capabilities ─────────────────────────────────────── -->
    <section class="container band">
      <div class="section-head">
        <h2>{{ sectionHead.title }}</h2>
        <p>{{ sectionHead.text }}</p>
      </div>

      <div class="grid">
        <article v-for="c in capabilities" :key="c.title" class="card cap">
          <span class="icon-chip sm"><HomeIcon :name="c.icon" /></span>
          <div>
            <h3>{{ c.title }}</h3>
            <p>{{ c.text }}</p>
          </div>
        </article>
      </div>
    </section>

    <!-- ── Closing CTA ──────────────────────────────────────── -->
    <section class="container band">
      <div class="cta">
        <h2>Run your first analysis today</h2>
        <p>Liatir is free and runs on your own computer, even without a network connection.</p>
        <div class="actions">
          <a class="btn btn-brand" :href="withBase('/download')">Download Liatir</a>
          <a class="btn btn-alt" :href="withBase('/getting-started/first-analysis')">First analysis guide</a>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home {
  padding-bottom: 96px;
}

.container {
  max-width: 1152px;
  margin: 0 auto;
  padding-inline: 24px;
}

.band {
  margin-top: 72px;
}

/* ── Hero ──────────────────────────────────────────────── */
.hero {
  position: relative;
  overflow: hidden;
  padding-top: 88px;
  padding-bottom: 32px;
}

.hero-inner {
  position: relative;
  z-index: 1;
}

.hero-copy {
  width: 54%;
  min-width: 0;
  text-align: left;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.hero-copy .headline,
.hero-copy .tagline {
  margin-inline: 0;
}

.hero-copy .actions,
.hero-copy .trust-metrics {
  justify-content: flex-start;
}

.status-wrapper {
  margin-bottom: 24px;
}

/* ── Status pill (più netta e rigorosa) ─────────────────────────── */
.status {
  display: inline-flex;
  flex-wrap: wrap;
  max-width: 100%;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  padding: 6px 16px;
  border-radius: 4px; /* Angoli più spigolosi = più "strumento tecnico" */
}

.hover-underline:hover {
  text-decoration: underline;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.hero-logo {
  height: 64px; /* Leggermente ridotto per pulizia */
  width: auto;
  margin: 0;
}

.name {
  margin: 20px 0 0;
  font-size: clamp(3rem, 8vw, 5rem);
  line-height: 1.1;
  font-weight: 800;
  letter-spacing: -0.04em;
  color: var(--vp-c-text-1); /* Sostituito il gradiente con un nero/bianco netto */
}

.headline {
  margin: 16px auto 0;
  max-width: 680px;
  font-size: clamp(1.4rem, 2.8vw, 2rem);
  line-height: 1.25;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
}

.tagline {
  margin: 16px auto 0;
  max-width: 580px;
  font-size: 1.1rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: center;
  margin-top: 40px;
}

.btn {
  display: inline-flex;
  align-items: center;
  height: 48px;
  padding: 0 28px;
  border-radius: 6px; /* Più "software", meno "app consumer" */
  font-size: 0.95rem;
  font-weight: 600;
  transition: all 0.2s ease;
}

.btn-brand {
  color: #fff;
  background: var(--vp-c-text-1); /* Bottone scuro ad alto contrasto (stile Vercel/Linear) */
  border: 1px solid var(--vp-c-text-1);
}

.btn-brand:hover {
  background: var(--vp-c-text-2);
  border-color: var(--vp-c-text-2);
}

html.dark .btn-brand {
  color: #000;
}

.btn-alt {
  color: var(--vp-c-text-1);
  background: transparent;
  border: 1px solid var(--vp-c-divider);
}

.btn-alt:hover {
  background: var(--vp-c-bg-soft);
  border-color: var(--vp-c-text-2);
}

/* Stile metriche (ispirato a Biotx e Regenetix) */
.trust-metrics {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 32px;
  margin-top: 56px;
  padding-top: 32px;
  border-top: 1px solid var(--vp-c-divider);
  width: 100%;
  max-width: 400px;
}

.metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.metric-val {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  letter-spacing: -0.02em;
}

.metric-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-3);
}

.metric-divider {
  width: 1px;
  height: 40px;
  background: var(--vp-c-divider);
}

/* ── Section heads ─────────────────────────────────────── */
.section-head {
  text-align: center;
  margin-bottom: 48px;
}

.section-head h2 {
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 0;
  color: var(--vp-c-text-1);
}

.section-head p {
  margin: 12px auto 0;
  max-width: 520px;
  color: var(--vp-c-text-2);
  font-size: 1.1rem;
}

/* ── Cards ─────────────────────────────────────────────── */
.card {
  background: var(--vp-c-bg); /* Rimosso il bg-soft per un look più piatto e clean */
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px; /* Più tech, meno giocattoloso */
  padding: 32px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.card:hover {
  border-color: var(--vp-c-text-2);
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.05);
}

.card h3 {
  margin: 0 0 8px;
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
}

.card p {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.pillars {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

.pillar h3 {
  margin-top: 24px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

.cap {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  padding: 24px;
}

/* ── Icon chips ────────────────────────────────────────── */
.icon-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 6px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  flex-shrink: 0;
}

.icon-chip svg {
  width: 24px;
  height: 24px;
}

.icon-chip.sm {
  width: 40px;
  height: 40px;
  border-radius: 6px;
}

.icon-chip.sm svg {
  width: 20px;
  height: 20px;
}

/* ── Closing CTA ───────────────────────────────────────── */
.cta {
  text-align: center;
  padding: 72px 32px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.cta h2 {
  font-size: clamp(1.8rem, 4vw, 2.5rem);
  font-weight: 750;
  letter-spacing: -0.03em;
  margin: 0;
  color: var(--vp-c-text-1);
}

.cta p {
  margin: 16px auto 0;
  max-width: 460px;
  color: var(--vp-c-text-2);
}

.cta .actions {
  margin-top: 32px;
}

/* ── Responsive ────────────────────────────────────────── */
@media (max-width: 767px) {
  .hero-copy {
    width: 100%;
    text-align: center;
    align-items: center;
  }

  .hero-copy .headline,
  .hero-copy .tagline {
    margin-inline: auto;
  }

  .hero-copy .actions,
  .hero-copy .trust-metrics,
  .status {
    justify-content: center;
  }

  .status-github,
  .status-github-separator {
    display: none;
  }
}

@media (max-width: 860px) {
  .pillars,
  .grid {
    grid-template-columns: 1fr;
  }

  .hide-on-small-screens {
    display: none !important;
  }

  .band {
    margin-top: 56px;
  }
}
</style>
