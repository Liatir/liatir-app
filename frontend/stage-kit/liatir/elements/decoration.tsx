/** Elements that only make a page look better: lines, space, coloured panels, drawings and icons. */
import * as React from "react"
import type { ILLUSTRATIONS } from "../../spec/page"
import { Icon, rich, type Renderers } from "../stage"

const range = (count: number) => Array.from({ length: count }, (_, index) => index)

// Each drawing is generated from a little geometry in a 320 × 120 box and takes the accent colour.
const DRAWINGS: Record<(typeof ILLUSTRATIONS)[number], () => React.ReactNode> = {
  dna: () => {
    const wave = (phase: number) => range(61).map((step) => `${10 + step * 5},${60 + 38 * Math.sin(step / 5.2 + phase)}`).join(" ")
    return (
      <>
        {range(20).map((rung) => {
          const turn = (rung * 3 + 1.5) / 5.2
          return <line key={rung} x1={17.5 + rung * 15} x2={17.5 + rung * 15} y1={60 + 38 * Math.sin(turn)} y2={60 - 38 * Math.sin(turn)} stroke="currentColor" strokeWidth={2} strokeOpacity={0.15 + 0.35 * Math.abs(Math.sin(turn))} />
        })}
        <polyline points={wave(0)} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
        <polyline points={wave(Math.PI)} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeOpacity={0.45} />
      </>
    )
  },
  molecule: () => {
    const ring = range(6).map((corner) => [160 + 34 * Math.cos((corner * Math.PI) / 3), 60 + 34 * Math.sin((corner * Math.PI) / 3)])
    const branches = [[ring[0], [236, 60]], [[236, 60], [262, 28]], [[236, 60], [262, 92]], [ring[3], [84, 60]], [[84, 60], [58, 32]]]
    const atoms = [...ring, [236, 60], [262, 28], [262, 92], [84, 60], [58, 32]]
    return (
      <>
        {ring.map((point, corner) => <line key={`r${corner}`} x1={point[0]} y1={point[1]} x2={ring[(corner + 1) % 6][0]} y2={ring[(corner + 1) % 6][1]} stroke="currentColor" strokeWidth={2.5} strokeOpacity={0.5} />)}
        {branches.map(([from, to], bond) => <line key={`b${bond}`} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke="currentColor" strokeWidth={2.5} strokeOpacity={0.5} />)}
        {atoms.map(([x, y], atom) => <circle key={atom} cx={x} cy={y} r={atom % 3 === 0 ? 9 : 6.5} fill={atom % 3 === 0 ? "currentColor" : "var(--background)"} stroke="currentColor" strokeWidth={2.5} />)}
      </>
    )
  },
  cells: () => [[52, 62, 34], [128, 40, 26], [150, 88, 22], [210, 58, 36], [276, 72, 28], [92, 98, 16]].map(([x, y, size], cell) => (
    <g key={cell}>
      <circle cx={x} cy={y} r={size} fill="currentColor" fillOpacity={0.12} stroke="currentColor" strokeOpacity={0.55} strokeWidth={2} />
      <circle cx={x + size * 0.2} cy={y - size * 0.15} r={size * 0.32} fill="currentColor" fillOpacity={0.55} />
    </g>
  )),
  network: () => {
    const nodes = [[30, 60], [86, 24], [92, 92], [150, 56], [206, 22], [212, 96], [270, 44], [296, 92]]
    const links = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5], [4, 6], [5, 6], [5, 7], [6, 7], [1, 2]]
    return (
      <>
        {links.map(([from, to], link) => <line key={link} x1={nodes[from][0]} y1={nodes[from][1]} x2={nodes[to][0]} y2={nodes[to][1]} stroke="currentColor" strokeOpacity={0.35} strokeWidth={2} />)}
        {nodes.map(([x, y], node) => <circle key={node} cx={x} cy={y} r={node === 3 ? 11 : 7} fill="currentColor" fillOpacity={node === 3 ? 1 : 0.7} />)}
      </>
    )
  },
  waves: () => range(3).map((layer) => (
    <path
      key={layer}
      d={`M0,120 L0,${70 + layer * 14} ${range(33).map((step) => `L${step * 10},${70 + layer * 14 + 16 * Math.sin(step / 4 + layer * 1.7)}`).join(" ")} L320,120 Z`}
      fill="currentColor" fillOpacity={0.14 + layer * 0.12}
    />
  )),
  rings: () => (
    <>
      {range(5).map((ring) => <circle key={ring} cx={160} cy={60} r={12 + ring * 11} fill="none" stroke="currentColor" strokeWidth={2} strokeOpacity={0.75 - ring * 0.13} />)}
      {range(5).map((ring) => {
        const angle = ring * 1.9
        return <circle key={`dot${ring}`} cx={160 + (12 + ring * 11) * Math.cos(angle)} cy={60 + (12 + ring * 11) * Math.sin(angle)} r={4} fill="currentColor" />
      })}
    </>
  ),
}

const SPACE = { small: "h-4", medium: "h-10", large: "h-20" }

export const decoration: Renderers<"divider" | "spacer" | "banner" | "illustration" | "icon"> = {
  "divider": ({ block }) => (
    <div className="flex items-center gap-3 py-1" role="separator">
      <div className="h-px flex-1 bg-border" />
      {block.label ? <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{block.label}</span> : null}
      {block.label ? <div className="h-px flex-1 bg-border" /> : null}
    </div>
  ),
  "spacer": ({ block }) => <div aria-hidden className={SPACE[block.size ?? "medium"]} />,
  "banner": ({ block }) => (
    <div className="relative overflow-hidden rounded-2xl bg-primary p-6 text-primary-foreground shadow-sm">
      {/* A light sheen over the solid colour: a see-through panel would show the section's backdrop. */}
      <div className="absolute inset-0 bg-linear-to-br from-transparent to-white/25" />
      {block.icon ? <Icon name={block.icon} className="absolute -right-3 -top-3 size-28 opacity-15" /> : null}
      <p className="relative text-2xl font-semibold tracking-tight">{rich(block.title)}</p>
      {block.text ? <p className="relative mt-1.5 max-w-prose text-primary-foreground/90">{rich(block.text)}</p> : null}
    </div>
  ),
  "illustration": ({ block }) => (
    <figure className="space-y-2">
      <svg viewBox="0 0 320 120" className="mx-auto w-full max-w-xl text-primary" aria-hidden>{DRAWINGS[block.name]()}</svg>
      {block.caption ? <figcaption className="text-center text-sm text-muted-foreground">{rich(block.caption)}</figcaption> : null}
    </figure>
  ),
  "icon": ({ block }) => (
    <div className="flex flex-col items-center gap-2 py-2 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-accent text-primary"><Icon name={block.name} className="size-8" /></span>
      {block.label ? <p className="text-sm font-medium">{rich(block.label)}</p> : null}
    </div>
  ),
}
