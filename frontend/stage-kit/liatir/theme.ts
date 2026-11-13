/** The accent colours a page can choose. One choice colours buttons, highlights and the first chart series. */
import type { ACCENTS } from "../spec/page"
import { setChartAccent } from "./charts"

// `replaces` is the chart-palette colour the accent stands in for, so a chart never shows two near-identical hues.
const ACCENT_COLORS = {
  teal: { primary: "#0a948b", tint: "#e6f4f3", ink: "#012723", replaces: 0 },
  blue: { primary: "#2563eb", tint: "#e8effd", ink: "#0b1f4d", replaces: 1 },
  amber: { primary: "#d97706", tint: "#fdf1dc", ink: "#451a03", replaces: 2 },
  violet: { primary: "#7c3aed", tint: "#f0e9fd", ink: "#2a1065", replaces: 3 },
  rose: { primary: "#e11d48", tint: "#fde8ed", ink: "#4c0519", replaces: 4 },
  green: { primary: "#059669", tint: "#e3f6ee", ink: "#052e16", replaces: 5 },
  slate: { primary: "#475569", tint: "#eef1f5", ink: "#0f172a", replaces: 7 },
} satisfies Record<(typeof ACCENTS)[number], { primary: string; tint: string; ink: string; replaces: number }>

/** Set on the document, because popups and menus are drawn outside the page's own element. */
export function applyAccent(name: (typeof ACCENTS)[number]) {
  const { primary, tint, ink, replaces } = ACCENT_COLORS[name]
  const style = document.documentElement.style
  style.setProperty("--primary", primary)
  style.setProperty("--ring", primary)
  style.setProperty("--accent", tint)
  style.setProperty("--accent-foreground", ink)
  setChartAccent(primary, replaces)
}
