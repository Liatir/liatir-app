/** Simple diagrams drawn from a few words: a process, a loop, overlapping sets. */
import * as React from "react"
import { ArrowDownIcon, ArrowRightIcon, RefreshCwIcon } from "lucide-react"
import { cn } from "../../lib/utils"
import { chartColor } from "../charts"
import { rich, type Renderers } from "../stage"

/** Circle centres for two and three sets, in a 300 × 200 drawing. */
const VENN = {
  2: { radius: 72, circles: [[108, 100], [192, 100]], labels: [[70, 100], [230, 100]], middle: [150, 100] },
  3: { radius: 60, circles: [[112, 76], [188, 76], [150, 134]], labels: [[84, 60], [216, 60], [150, 162]], middle: [150, 98] },
} as const

/**
 * The width from which a flow of n boxes goes side by side (about 150px a box), measured on the
 * element's own cell (a container query), so a flow in a narrow column stacks instead of overflowing.
 * Written out in full so each class appears as a literal.
 */
const FLOW_ROW = {
  2: { row: "@min-[320px]:flex-row", turn: "@max-[319px]:rotate-90" },
  3: { row: "@min-[460px]:flex-row", turn: "@max-[459px]:rotate-90" },
  4: { row: "@min-[600px]:flex-row", turn: "@max-[599px]:rotate-90" },
  5: { row: "@min-[740px]:flex-row", turn: "@max-[739px]:rotate-90" },
  6: { row: "@min-[880px]:flex-row", turn: "@max-[879px]:rotate-90" },
} as Record<number, { row: string; turn: string }>

export const diagrams: Renderers<"flow" | "cycle" | "venn"> = {
  "flow": ({ block }) => {
    const down = block.direction === "down"
    const fit = FLOW_ROW[block.items.length]
    return (
      <div className={cn("flex flex-col items-stretch gap-2", !down && fit.row)}>
        {block.items.map((item, index) => (
          <React.Fragment key={index}>
            {index ? (
              down
                ? <ArrowDownIcon className="size-5 shrink-0 self-center text-primary" />
                // Side by side when there is room, stacked (so pointing down) when there is not.
                : <ArrowRightIcon className={cn("size-5 shrink-0 self-center text-primary", fit.turn)} />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col justify-center rounded-xl border bg-card p-3 text-center shadow-xs">
              <p className="font-medium">{rich(item.title)}</p>
              {item.text ? <p className="mt-1 text-sm text-muted-foreground">{rich(item.text)}</p> : null}
            </div>
          </React.Fragment>
        ))}
      </div>
    )
  },
  "cycle": ({ block }) => (
    <>
      {/* Too narrow for a circle of boxes: a numbered list that says it starts again. */}
      <ol className="space-y-2 @min-[380px]:hidden">
        {block.items.map((item, index) => (
          <li key={index} className="flex gap-2.5 rounded-xl border bg-card p-3">
            <span className="text-sm font-semibold text-primary">{index + 1}</span>
            <div><p className="font-medium leading-tight">{rich(item.title)}</p>{item.text ? <p className="mt-0.5 text-sm text-muted-foreground">{rich(item.text)}</p> : null}</div>
          </li>
        ))}
        <li className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCwIcon className="size-4 text-primary" /> Back to step 1</li>
      </ol>
      <div className="relative mx-auto hidden aspect-square w-full max-w-md @min-[380px]:block">
        <div className="absolute inset-[18%] rounded-full border-2 border-dashed border-primary/40" />
        <RefreshCwIcon className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-primary/50" />
        {block.items.map((item, index) => {
          // Clockwise from the top.
          const angle = (index / block.items.length) * 2 * Math.PI - Math.PI / 2
          return (
            <div
              key={index}
              className="absolute w-[34%] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-2 text-center shadow-xs"
              style={{ left: `${50 + 32 * Math.cos(angle)}%`, top: `${50 + 32 * Math.sin(angle)}%` }}
            >
              <p className="text-xs font-semibold text-primary">{index + 1}</p>
              <p className="text-sm font-medium leading-tight">{rich(item.title)}</p>
              {item.text ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{rich(item.text)}</p> : null}
            </div>
          )
        })}
      </div>
    </>
  ),
  "venn": ({ block }) => {
    const layout = VENN[block.sets.length === 3 ? 3 : 2]
    return (
      <svg viewBox="0 0 300 200" className="mx-auto w-full max-w-lg" role="img" aria-label={`Overlap of ${block.sets.join(", ")}`}>
        {layout.circles.map(([x, y], index) => (
          <circle key={index} cx={x} cy={y} r={layout.radius} fill={chartColor(index)} fillOpacity={0.22} stroke={chartColor(index)} strokeWidth={1.5} />
        ))}
        {layout.labels.map(([x, y], index) => (
          <text key={index} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-[11px] font-medium">{block.sets[index]}</text>
        ))}
        {block.overlap ? (
          <text x={layout.middle[0]} y={layout.middle[1]} textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-[10px] font-semibold">{block.overlap}</text>
        ) : null}
      </svg>
    )
  },
}
