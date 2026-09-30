<script setup lang="ts">
import { withBase } from 'vitepress'
import HomeIcon from './HomeIcon.vue'
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
      
      <!-- Scientific Data Background -->
      <div class="scientific-canvas" aria-hidden="true">
        <div class="grid-layer"></div>
        <div class="genomic-tracks">
          <div class="track t1"></div>
          <div class="track t2"></div>
          <div class="track t3"></div>
          <div class="track t4"></div>
          <div class="track t5"></div>
        </div>
      </div>

      <!-- Placeholder per eventuali grafiche 3D laterali (es. DNA/Proteine) -->
      <!-- <img class="hero-side-graphic left" src="..." alt="" /> -->
      <!-- <img class="hero-side-graphic right" src="..." alt="" /> -->

      <div class="container hero-inner">
        <div class="status-wrapper">
          <span class="status"><span class="status-dot" aria-hidden="true"></span><span><span style="text-transform: lowercase;">v</span>{{pkgJson.version}}</span> · <span>Open Source</span> · <a href="https://www.gnu.org/licenses/gpl-3.0" class="hover-underline" target="_blank">GNU GPL v3</a> · <a href="https://github.com/Liatir/liatir-app" class="hover-underline" target="_blank">GitHub</a></span>
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

/* Sfondo Scientifico (Sostituisce il glow) */
.scientific-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
  /* Maschera spostata al 0% (in cima) per far partire i dati attaccati alla nav */
  mask-image: radial-gradient(ellipse at 50% 0%, black 30%, transparent 80%);
  -webkit-mask-image: radial-gradient(ellipse at 50% 0%, black 30%, transparent 80%);
}

.grid-layer {
  position: absolute;
  inset: 0;
  background-image: 
    linear-gradient(var(--vp-c-divider) 1px, transparent 1px),
    linear-gradient(90deg, var(--vp-c-divider) 1px, transparent 1px);
  background-size: 48px 48px;
  opacity: 0.3;
}

.genomic-tracks {
  position: absolute;
  top: 0; /* <-- Modificato: Ora partono esattamente da in cima */
  left: 50%;
  transform: translateX(-50%);
  width: 120vw;
  display: flex;
  flex-direction: column;
  gap: 24px;
  opacity: 0.45; /* Leggermente aumentata per farli risaltare un po' di più sotto la nav */
}

/* ── Animazioni dei tracciati ──────────────────────────── */
@keyframes streamData {
  0% { background-position: 0 0; }
  100% { background-position: -400px 0; }
}
@keyframes streamDataReverse {
  0% { background-position: 0 0; }
  100% { background-position: 400px 0; }
}

.track {
  height: 12px;
  width: 100%;
  background-repeat: repeat-x;
}

/* Pattern CSS animati per simulare gli allineamenti / blocchi genomici */
.t1 { 
  background-image: repeating-linear-gradient(90deg, var(--vp-c-brand-1) 0, var(--vp-c-brand-1) 40px, transparent 40px, transparent 90px, var(--vp-c-brand-2) 90px, var(--vp-c-brand-2) 160px, transparent 160px, transparent 220px); 
  animation: streamData 40s linear infinite;
}
.t2 { 
  background-image: repeating-linear-gradient(90deg, transparent 0, transparent 60px, var(--vp-c-text-2) 60px, var(--vp-c-text-2) 100px, transparent 100px, transparent 180px, var(--vp-c-brand-3, var(--vp-c-brand-1)) 180px, var(--vp-c-brand-3, var(--vp-c-brand-1)) 210px, transparent 210px, transparent 260px); 
  animation: streamDataReverse 55s linear infinite;
}
.t3 { 
  background-image: repeating-linear-gradient(90deg, var(--vp-c-brand-2) 0, var(--vp-c-brand-2) 20px, transparent 20px, transparent 110px, var(--vp-c-text-3) 110px, var(--vp-c-text-3) 150px, transparent 150px, transparent 200px); 
  animation: streamData 30s linear infinite;
}
.t4 { 
  background-image: repeating-linear-gradient(90deg, transparent 0, transparent 30px, var(--vp-c-brand-1) 30px, var(--vp-c-brand-1) 80px, transparent 80px, transparent 140px, var(--vp-c-brand-2) 140px, var(--vp-c-brand-2) 190px, transparent 190px, transparent 250px); 
  animation: streamDataReverse 45s linear infinite;
}
.t5 { 
  background-image: repeating-linear-gradient(90deg, var(--vp-c-text-2) 0, var(--vp-c-text-2) 50px, transparent 50px, transparent 120px, var(--vp-c-brand-1) 120px, var(--vp-c-brand-1) 160px, transparent 160px, transparent 280px); 
  animation: streamData 60s linear infinite;
}

.hero-inner {
  position: relative;
  z-index: 1;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.status-wrapper {
  margin-bottom: 24px;
}

/* ── Status pill (più netta e rigorosa) ─────────────────────────── */
.status {
  display: inline-flex;
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