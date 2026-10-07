<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'

type HelixConfig = {
  cx: number
  R: number
  scale: number
  nodes: number
  turns: number
  alphaScale: number
  dir: number
}
type HelixPoint = { x: number; y: number; z: number; glow: number }

const { isDark } = useData()
const background = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
let cleanup = () => {}

onMounted(() => {
  const mountedCanvas = canvas.value
  const mountedHero = background.value?.parentElement
  const mountedContext = mountedCanvas?.getContext('2d')
  if (!mountedCanvas || !mountedHero || !mountedContext) return
  const surface = mountedCanvas
  const hero = mountedHero
  const ctx = mountedContext
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const mobile = window.matchMedia('(max-width: 767px)')

  let width = 0
  let height = 0
  let rafId = 0
  let inView = true
  let rot = Math.random() * Math.PI * 2
  let lastFrame = 0
  const rotationSpeed = 0.25
  let lean = 0
  let targetLean = 0
  const mouse = { x: -9999, y: -9999 }

  function readBrandColor() {
    return getComputedStyle(hero).getPropertyValue('--vp-c-brand-1').trim()
  }
  let brandColor = readBrandColor()

  function hexToRgba(hex: string, alpha: number) {
    hex = hex.replace('#', '')
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
    const n = parseInt(hex, 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
  }

  // Tablet and desktop share the approved proportions; excess turns stay cropped inside the hero.
  function drawHelix(cfg: HelixConfig) {
    const { nodes, turns, cx, R, scale } = cfg
    const verticalScale = scale * 1.25
    const strokeScale = scale * 1.4
    const strandEmphasis = 2
    const angle = Math.PI / 18
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const margin = 60
    const span = height + margin * 2
    const step = span / (nodes - 1)
    const centerY = height / 2
    const strands: HelixPoint[][] = [[], []]

    for (let s = 0; s < 2; s++) {
      for (let i = 0; i < nodes; i++) {
        const localY = (i * step - margin - centerY) * verticalScale
        const phase = (i / (nodes - 1)) * turns * Math.PI * 2 * cfg.dir + rot * cfg.dir + s * Math.PI
        const localX = lean * (localY / height) + Math.sin(phase) * R
        let x = cx + localX * cos - localY * sin
        let y = centerY + localX * sin + localY * cos
        const z = Math.cos(phase)
        let glow = 0
        const dx = x - mouse.x
        const dy = y - mouse.y
        const d = Math.sqrt(dx * dx + dy * dy)
        const radius = 130
        if (d < radius && d > 0.001) {
          const f = 1 - d / radius
          x += (dx / d) * f * f * 34
          y += (dy / d) * f * f * 14
          glow = f
        }
        strands[s].push({ x, y, z, glow })
      }
    }

    // Base pairs.
    ctx.lineWidth = 1.4 * strokeScale
    for (let i = 0; i < nodes; i += 4) {
      const p1 = strands[0][i]
      const p2 = strands[1][i]
      const avgZ = (p1.z + p2.z) / 2
      const vis = 1 - Math.abs(avgZ)
      const glowR = Math.max(p1.glow, p2.glow)
      const alpha = (0.10 + 0.45 * vis) * cfg.alphaScale + glowR * 0.35
      ctx.strokeStyle = hexToRgba(brandColor, Math.min(alpha, 0.9))
      ctx.beginPath()
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(p2.x, p2.y)
      ctx.stroke()
    }

    // The two strand backbones.
    for (let s = 0; s < 2; s++) {
      for (let i = 0; i < nodes - 1; i++) {
        const a = strands[s][i]
        const b = strands[s][i + 1]
        const depth = ((a.z + b.z) / 2 + 1) / 2
        ctx.strokeStyle = hexToRgba(brandColor, (0.06 + 0.22 * depth) * cfg.alphaScale)
        ctx.lineWidth = 1.2 * strokeScale * strandEmphasis
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }

    // Draw the nucleotides from farthest to nearest.
    const all = strands.flat().sort((m, n) => m.z - n.z)
    for (const p of all) {
      const persp = (p.z + 1) / 2
      const r = (1.5 + 2.7 * persp) * (1 + p.glow * 0.9) * scale * strandEmphasis
      if (p.glow > 0.02) {
        ctx.fillStyle = hexToRgba(brandColor, p.glow * 0.22 * cfg.alphaScale)
        ctx.beginPath()
        ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = hexToRgba(brandColor, Math.min((0.22 + 0.78 * persp) * cfg.alphaScale + p.glow * 0.4, 1))
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  function draw() {
    if (mobile.matches || !width || !height) return
    ctx.clearRect(0, 0, width, height)
    const originalR = Math.max(52, Math.min(width * 0.075, 110))
    const R = Math.max(88, Math.min(width * 0.14, 190))
    const scale = R / originalR
    const cx = width / 2 + Math.min(width * 0.28, 340)
    drawHelix({ cx, R, scale, nodes: 58, turns: 3.1, alphaScale: 1, dir: 1 })
  }

  function frame(now: number) {
    const elapsed = Math.min((now - lastFrame) / 1000, 0.1)
    lastFrame = now
    lean += (targetLean - lean) * 0.05
    // Elapsed time keeps the slow rotation identical on different refresh-rate displays.
    rot += rotationSpeed * elapsed
    draw()
    rafId = requestAnimationFrame(frame)
  }

  function syncAnimation() {
    cancelAnimationFrame(rafId)
    rafId = 0
    lastFrame = performance.now()
    draw()
    if (!mobile.matches && !motion.matches && inView && !document.hidden) {
      rafId = requestAnimationFrame(frame)
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = hero.getBoundingClientRect()
    width = rect.width
    height = rect.height
    surface.width = Math.round(width * dpr)
    surface.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw()
  }

  function moveMouse(event: MouseEvent) {
    if (mobile.matches || motion.matches) return
    const rect = hero.getBoundingClientRect()
    mouse.x = event.clientX - rect.left
    mouse.y = event.clientY - rect.top
    targetLean = ((mouse.x / width) - 0.5) * 56
  }

  function leaveMouse() {
    mouse.x = -9999
    mouse.y = -9999
    targetLean = 0
  }

  function changeAnimationMode() {
    if (mobile.matches || motion.matches) {
      leaveMouse()
      lean = 0
    }
    syncAnimation()
  }

  const sizeObserver = new ResizeObserver(resize)
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting
    syncAnimation()
  })
  const stopThemeWatch = watch(isDark, () => {
    brandColor = readBrandColor()
    draw()
  }, { flush: 'post' })

  resize()
  sizeObserver.observe(hero)
  visibilityObserver.observe(hero)
  hero.addEventListener('mousemove', moveMouse, { passive: true })
  hero.addEventListener('mouseleave', leaveMouse)
  motion.addEventListener('change', changeAnimationMode)
  mobile.addEventListener('change', changeAnimationMode)
  document.addEventListener('visibilitychange', syncAnimation)
  syncAnimation()

  cleanup = () => {
    cancelAnimationFrame(rafId)
    sizeObserver.disconnect()
    visibilityObserver.disconnect()
    stopThemeWatch()
    hero.removeEventListener('mousemove', moveMouse)
    hero.removeEventListener('mouseleave', leaveMouse)
    motion.removeEventListener('change', changeAnimationMode)
    mobile.removeEventListener('change', changeAnimationMode)
    document.removeEventListener('visibilitychange', syncAnimation)
  }
})

onBeforeUnmount(() => cleanup())
</script>

<template>
  <div ref="background" class="scientific-canvas" aria-hidden="true">
    <div class="grid-layer"></div>
    <canvas ref="canvas" class="dna-canvas"></canvas>
  </div>
</template>

<style scoped>
.scientific-canvas {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.grid-layer {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(var(--vp-c-divider) 1px, transparent 1px),
    linear-gradient(90deg, var(--vp-c-divider) 1px, transparent 1px);
  background-size: 48px 48px;
  opacity: 0.3;
  mask-image: radial-gradient(ellipse at 50% 0%, black 30%, transparent 80%);
  -webkit-mask-image: radial-gradient(ellipse at 50% 0%, black 30%, transparent 80%);
}

.dna-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  mask-image: linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%);
}

@media (max-width: 767px) {
  .dna-canvas {
    display: none;
  }
}
</style>
