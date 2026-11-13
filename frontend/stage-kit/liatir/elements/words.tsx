/** Elements made of words: paragraphs, lists, notes, comparisons. */
import * as React from "react"
import { ArrowRightIcon, CheckIcon, CircleCheckIcon, CircleXIcon, InfoIcon, TriangleAlertIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert"
import { Badge } from "../../ui/badge"
import { cn } from "../../lib/utils"
import { Icon, Sourced, rich, type Renderers } from "../stage"

const TONES = {
  info: { icon: InfoIcon, style: "border-blue-200 bg-blue-50 text-blue-950 *:data-[slot=alert-description]:text-blue-900" },
  success: { icon: CircleCheckIcon, style: "border-emerald-200 bg-emerald-50 text-emerald-950 *:data-[slot=alert-description]:text-emerald-900" },
  warning: { icon: TriangleAlertIcon, style: "border-amber-200 bg-amber-50 text-amber-950 *:data-[slot=alert-description]:text-amber-900" },
  danger: { icon: CircleXIcon, style: "border-red-200 bg-red-50 text-red-950 *:data-[slot=alert-description]:text-red-900" },
}

function Marker({ kind, index }: { kind: "dot" | "check" | "arrow" | "number"; index: number }) {
  if (kind === "check") return <CheckIcon className="mt-1 size-4 shrink-0 text-primary" />
  if (kind === "arrow") return <ArrowRightIcon className="mt-1 size-4 shrink-0 text-primary" />
  if (kind === "number") return <span className="shrink-0 font-semibold tabular-nums text-primary">{index + 1}.</span>
  return <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" />
}

function Detail({ text }: { text?: string }) {
  return text ? <p className="mt-0.5 text-sm text-muted-foreground">{rich(text)}</p> : null
}

export const words: Renderers<
  "text" | "heading" | "bullets" | "steps" | "timeline" | "quote" | "statement" | "callout" | "code" | "terms" | "comparison" | "icon-cards" | "badges" | "facts"
> = {
  "text": ({ block }) => (
    <p className={cn("whitespace-pre-line leading-relaxed", block.size === "small" ? "text-sm text-muted-foreground" : block.size === "large" ? "text-xl" : "text-base")}>
      {rich(block.text)}
    </p>
  ),
  "heading": ({ block }) => <h3 className="text-xl font-semibold tracking-tight">{rich(block.text)}</h3>,
  "bullets": ({ block }) => (
    <ul className="space-y-2">
      {block.items.map((item, index) => (
        <li key={index} className="flex gap-2.5">
          <Marker kind={block.marker ?? "dot"} index={index} />
          <span>{rich(item)}</span>
        </li>
      ))}
    </ul>
  ),
  "steps": ({ block }) => (
    <ol className="space-y-4">
      {block.items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{index + 1}</span>
          <div><p className="font-medium">{rich(item.title)}</p><Detail text={item.text} /></div>
        </li>
      ))}
    </ol>
  ),
  "timeline": ({ block }) => (
    <ol className="ml-1.5 space-y-5 border-l-2 border-border pl-5">
      {block.items.map((item, index) => (
        <li key={index} className="relative">
          <span className="absolute -left-[27px] top-1.5 size-3 rounded-full bg-primary ring-4 ring-background" />
          <p className="text-xs font-medium uppercase tracking-wide text-primary">{item.when}</p>
          <p className="font-medium">{rich(item.title)}</p>
          <Detail text={item.text} />
        </li>
      ))}
    </ol>
  ),
  "quote": ({ block }) => (
    <figure className="border-l-4 border-primary pl-4">
      <blockquote className="text-lg italic leading-relaxed">{rich(block.text)}</blockquote>
      {block.author ? <figcaption className="mt-2 text-sm text-muted-foreground">— {block.author}</figcaption> : null}
    </figure>
  ),
  "statement": ({ block }) => (
    <p className="py-4 text-center text-3xl font-semibold leading-tight tracking-tight text-balance text-primary">{rich(block.text)}</p>
  ),
  "callout": ({ block }) => {
    const tone = TONES[block.tone]
    return (
      <Alert className={tone.style}>
        <tone.icon />
        {block.title ? <AlertTitle className="line-clamp-none">{rich(block.title)}</AlertTitle> : null}
        <AlertDescription><p>{rich(block.text)}</p></AlertDescription>
      </Alert>
    )
  },
  "code": ({ block }) => (
    <figure className="space-y-2">
      <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-4 font-mono text-sm leading-relaxed text-zinc-100"><code>{block.code}</code></pre>
      {block.caption ? <figcaption className="text-xs text-muted-foreground">{rich(block.caption)}</figcaption> : null}
    </figure>
  ),
  "terms": ({ block }) => (
    <dl className="space-y-3">
      {block.items.map((item, index) => (
        <div key={index}>
          <dt className="font-medium">{item.term}</dt>
          <dd className="text-sm text-muted-foreground">{rich(item.text)}</dd>
        </div>
      ))}
    </dl>
  ),
  "comparison": ({ block }) => (
    <div className="grid gap-4 @min-[440px]:grid-cols-2">
      {[block.left, block.right].map((part, index) => (
        <div key={index} className={cn("rounded-xl border p-4", index ? "border-primary/30 bg-accent/60" : "bg-card")}>
          <p className="mb-2 font-semibold">{rich(part.title)}</p>
          <ul className="space-y-1.5 text-sm">
            {part.items.map((item, position) => (
              <li key={position} className="flex gap-2"><Marker kind="dot" index={position} /><span>{rich(item)}</span></li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  ),
  "icon-cards": ({ block }) => (
    <div className="grid gap-3 @min-[440px]:grid-cols-2">
      {block.items.map((item, index) => (
        <div key={index} className="flex gap-3 rounded-xl border bg-card p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary"><Icon name={item.icon} className="size-5" /></span>
          <div><p className="font-medium">{rich(item.title)}</p><Detail text={item.text} /></div>
        </div>
      ))}
    </div>
  ),
  "badges": ({ block }) => (
    <div className="flex flex-wrap gap-2">
      {block.items.map((item, index) => <Badge key={index} variant="secondary" className="px-3 py-1 text-sm">{item}</Badge>)}
    </div>
  ),
  "facts": ({ block }) => (
    <div className="space-y-2">
      <dl className="divide-y divide-border rounded-xl border bg-card">
        {block.items.map((item, index) => (
          <div key={index} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className="text-right font-medium">{rich(item.value)}</dd>
          </div>
        ))}
      </dl>
      {/* Typed values that contain digits read as data, so they carry the same label as typed charts. */}
      {block.items.some((item) => /\d/.test(item.value)) ? <Sourced origin={{}} /> : null}
    </div>
  ),
}
