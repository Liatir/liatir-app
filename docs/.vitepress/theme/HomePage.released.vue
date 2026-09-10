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
</script>

<template>
  <div class="home">
    <!-- ── Hero ─────────────────────────────────────────────── -->
    <section class="hero">
      <div class="hero-glow" aria-hidden="true"></div>

      <div class="container hero-inner">
        <span class="eyebrow">Local-first bioinformatics</span>

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
          <a class="btn btn-brand" :href="withBase('/introduction/overview')">Get started</a>
          <a class="btn btn-alt" :href="withBase('/plugins/overview')">Build a plugin</a>
        </div>

        <p class="trust">{{ heroTrust.join(' · ') }}</p>
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
        <h2>Start where you are</h2>
        <p>Run your first tool in minutes, then extend Liatir with your own plugins.</p>
        <div class="actions">
          <a class="btn btn-brand" :href="withBase('/introduction/overview')">Read the intro</a>
          <a class="btn btn-alt" :href="withBase('/tools/overview')">Browse the tools</a>
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
  padding-bottom: 8px;
}

.hero-glow {
  position: absolute;
  top: -220px;
  left: 50%;
  transform: translateX(-50%);
  width: 900px;
  height: 600px;
  background: radial-gradient(
    circle at center,
    color-mix(in srgb, var(--vp-c-brand-1) 26%, transparent) 0%,
    transparent 62%
  );
  filter: blur(20px);
  pointer-events: none;
  z-index: 0;
}

.hero-inner {
  position: relative;
  z-index: 1;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.eyebrow {
  display: inline-block;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 22%, transparent);
  padding: 6px 14px;
  border-radius: 999px;
}

.name {
  margin: 22px 0 0;
  font-size: clamp(3.25rem, 9vw, 5.5rem);
  line-height: 1;
  font-weight: 800;
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, var(--vp-c-brand-1) 0%, var(--vp-c-brand-soft) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.headline {
  margin: 20px auto 0;
  max-width: 620px;
  font-size: clamp(1.25rem, 2.6vw, 1.6rem);
  line-height: 1.3;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.tagline {
  margin: 16px auto 0;
  max-width: 560px;
  font-size: 1.02rem;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  justify-content: center;
  margin-top: 34px;
}

.btn {
  display: inline-flex;
  align-items: center;
  height: 46px;
  padding: 0 24px;
  border-radius: 999px;
  font-size: 0.95rem;
  font-weight: 600;
  transition: transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
}

.btn:hover {
  transform: translateY(-2px);
}

.btn-brand {
  color: #fff;
  background: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-brand-1);
}

.btn-brand:hover {
  background: var(--vp-c-brand-2);
  border-color: var(--vp-c-brand-2);
}

.btn-alt {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}

.btn-alt:hover {
  border-color: var(--vp-c-brand-1);
}

.trust {
  margin-top: 26px;
  font-size: 0.85rem;
  letter-spacing: 0.01em;
  color: var(--vp-c-text-3);
}

/* ── Section heads ─────────────────────────────────────── */
.section-head {
  text-align: center;
  margin-bottom: 36px;
}

.section-head h2 {
  font-size: clamp(1.5rem, 3.5vw, 2rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0;
}

.section-head p {
  margin: 10px auto 0;
  max-width: 520px;
  color: var(--vp-c-text-2);
}

/* ── Cards ─────────────────────────────────────────────── */
.card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  padding: 26px;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.card:hover {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 45%, var(--vp-c-divider));
  box-shadow: 0 12px 30px color-mix(in srgb, var(--vp-c-brand-1) 12%, transparent);
}

.card h3 {
  margin: 0 0 6px;
  font-size: 1.05rem;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
}

.card p {
  margin: 0;
  font-size: 0.93rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.pillars {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.pillar h3 {
  margin-top: 18px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.cap {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

/* ── Icon chips ────────────────────────────────────────── */
.icon-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 12px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 18%, transparent);
  flex-shrink: 0;
}

.icon-chip svg {
  width: 24px;
  height: 24px;
}

.icon-chip.sm {
  width: 40px;
  height: 40px;
  border-radius: 10px;
}

.icon-chip.sm svg {
  width: 21px;
  height: 21px;
}

/* ── Closing CTA ───────────────────────────────────────── */
.cta {
  text-align: center;
  padding: 56px 32px;
  border-radius: 24px;
  border: 1px solid var(--vp-c-divider);
  background:
    radial-gradient(
      circle at 50% 0%,
      var(--vp-c-brand-soft) 0%,
      transparent 70%
    ),
    var(--vp-c-bg-soft);
}

.cta h2 {
  font-size: clamp(1.6rem, 4vw, 2.2rem);
  font-weight: 750;
  letter-spacing: -0.02em;
  margin: 0;
}

.cta p {
  margin: 12px auto 0;
  max-width: 460px;
  color: var(--vp-c-text-2);
}

.cta .actions {
  margin-top: 28px;
}

/* ── Responsive ────────────────────────────────────────── */
@media (max-width: 860px) {
  .pillars,
  .grid {
    grid-template-columns: 1fr;
  }

  .band {
    margin-top: 56px;
  }
}
</style>
