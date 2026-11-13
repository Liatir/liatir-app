/**
 * Every element type with its renderer, and the grid that lays elements out. The `satisfies` below
 * fails to compile when an element defined in `spec/page.ts` has no renderer here.
 */
import * as React from "react"
import { MaximizeIcon } from "lucide-react"
import { Button } from "../../ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select"
import { Tabs, TabsList, TabsTrigger } from "../../ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "../../ui/toggle-group"
import type { Block, BlockType } from "../../spec/page"
import { rich, type Renderers } from "../stage"
import { data } from "./data"
import { decoration } from "./decoration"
import { diagrams } from "./diagrams"
import { interactive } from "./interactive"
import { words } from "./words"

/**
 * A grid of elements, `columns` to a row. Laid out as a wrapping row whose elements grow, so a row that
 * is not full — one element in a two-column section, the fourth on a three-column one — fills the width
 * instead of leaving a hole. Widths are those of the space the grid has (container queries), so a grid
 * inside a card or a narrow column stacks sooner: side by side from 560px, four columns two to a row
 * until 900px. Each element is itself a container, so it adapts to its own cell the same way. Each
 * element fades in a moment after the one before whenever the grid is shown.
 */
export function Blocks({ blocks, columns }: { blocks: readonly Block[]; columns: number }) {
  // A little under an exact share, so `columns` elements and the gaps between them fit on one row.
  const basis = (span: number, perRow: number) => `calc(${(Math.min(span, perRow) / perRow) * 100}% - 1rem)`
  return (
    <div className="@container"><div className="flex flex-wrap gap-4">
      {blocks.map((block, index) => {
        const span = block.span ?? 1
        return (
          <div
            key={index}
            className="@container min-w-0 basis-full animate-in fade-in-0 slide-in-from-bottom-3 fill-mode-both duration-500 motion-reduce:animate-none @min-[560px]:basis-[var(--narrow)] @min-[900px]:basis-[var(--wide)]"
            style={{ flexGrow: span, animationDelay: `${index * 80}ms`, "--narrow": basis(span, columns === 4 ? 2 : columns), "--wide": basis(span, columns) } as React.CSSProperties}
          >
            <Element block={block} />
          </div>
        )
      })}
    </div></div>
  )
}

const containers: Renderers<"card" | "grid" | "tabs" | "popup"> = {
  "card": ({ block }) => (
    <Card className="gap-4 py-5">
      {block.title ? <CardHeader><CardTitle>{rich(block.title)}</CardTitle></CardHeader> : null}
      <CardContent><Blocks blocks={block.blocks} columns={block.columns ?? 1} /></CardContent>
    </Card>
  ),
  "grid": ({ block }) => <Blocks blocks={block.blocks} columns={block.columns} />,
  "tabs": ({ block }) => {
    const [active, setActive] = React.useState("0")
    const options = block.tabs.map((tab, index) => ({ value: String(index), label: tab.label }))
    return (
      <div className="space-y-4">
        {block.style === "dropdown" ? (
          <Select value={active} onValueChange={setActive}>
            <SelectTrigger className="min-w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        ) : block.style === "buttons" ? (
          // Radix reports "" when the pressed button is pressed again; one view always stays chosen.
          <ToggleGroup type="single" variant="outline" value={active} onValueChange={(value) => { if (value) setActive(value) }}>
            {options.map((option) => <ToggleGroupItem key={option.value} value={option.value} className="px-3">{option.label}</ToggleGroupItem>)}
          </ToggleGroup>
        ) : (
          <Tabs value={active} onValueChange={setActive}>
            <TabsList>{options.map((option) => <TabsTrigger key={option.value} value={option.value}>{option.label}</TabsTrigger>)}</TabsList>
          </Tabs>
        )}
        {/* Keyed so the chosen view is drawn fresh, with its entrance. */}
        <Blocks key={active} blocks={block.tabs[Number(active)].blocks} columns={1} />
      </div>
    )
  },
  "popup": ({ block }) => (
    <Dialog>
      <DialogTrigger asChild><Button variant="outline"><MaximizeIcon /> {block.button}</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{block.title}</DialogTitle>
          <DialogDescription className="sr-only">{block.title}</DialogDescription>
        </DialogHeader>
        <Blocks blocks={block.blocks} columns={1} />
      </DialogContent>
    </Dialog>
  ),
}

const RENDERERS = { ...words, ...data, ...diagrams, ...interactive, ...decoration, ...containers } satisfies Renderers<BlockType>

function Element({ block }: { block: Block }) {
  const Render = RENDERERS[block.type] as (props: { block: Block }) => React.ReactNode
  return <Render block={block} />
}
