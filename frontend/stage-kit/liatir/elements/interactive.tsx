/** Elements the viewer acts on: open, answer, tick, step through, turn over. */
import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon, CircleHelpIcon, EyeIcon, RotateCcwIcon } from "lucide-react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../../ui/accordion"
import { Button } from "../../ui/button"
import { Checkbox } from "../../ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover"
import { cn } from "../../lib/utils"
import { rich, type Renderers } from "../stage"

export const interactive: Renderers<"accordion" | "hint" | "quiz" | "reveal" | "checklist" | "walkthrough" | "flip-cards"> = {
  "accordion": ({ block }) => (
    <Accordion type="single" collapsible className="rounded-xl border bg-card px-4">
      {block.items.map((item, index) => (
        <AccordionItem key={index} value={String(index)}>
          <AccordionTrigger>{rich(item.title)}</AccordionTrigger>
          <AccordionContent className="text-muted-foreground">{rich(item.text)}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
  "hint": ({ block }) => (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1.5 font-medium underline decoration-primary decoration-dotted decoration-2 underline-offset-4">
          {block.term}
          <CircleHelpIcon className="size-4 text-primary" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="text-sm leading-relaxed">{rich(block.text)}</PopoverContent>
    </Popover>
  ),
  "quiz": ({ block }) => {
    const [picked, setPicked] = React.useState<number | null>(null)
    return (
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <p className="font-medium">{rich(block.question)}</p>
        <div className="grid gap-2">
          {block.options.map((option, index) => {
            const right = index + 1 === block.answer
            return (
              <Button
                key={index}
                variant="outline"
                aria-pressed={picked === index}
                className={cn(
                  "h-auto justify-start whitespace-normal py-2 text-left",
                  // Once answered, the right option is always shown, and a wrong pick is marked.
                  picked !== null && right && "border-emerald-500 bg-emerald-50 text-emerald-900 hover:bg-emerald-50",
                  picked === index && !right && "border-red-400 bg-red-50 text-red-900 hover:bg-red-50",
                )}
                onClick={() => setPicked(index)}
              >
                {rich(option)}
              </Button>
            )
          })}
        </div>
        {picked !== null ? (
          <p className="text-sm text-muted-foreground animate-in fade-in-0 duration-300">
            <span className="font-medium text-foreground">{picked + 1 === block.answer ? "Correct." : "Not quite."}</span>
            {block.explanation ? <> {rich(block.explanation)}</> : null}
          </p>
        ) : null}
      </div>
    )
  },
  "reveal": ({ block }) => {
    const [shown, setShown] = React.useState(false)
    return (
      <div className="space-y-3">
        <Button variant="outline" aria-expanded={shown} onClick={() => setShown(!shown)}><EyeIcon /> {block.button}</Button>
        {shown ? <p className="rounded-xl border bg-accent/60 p-4 leading-relaxed animate-in fade-in-0 slide-in-from-top-2 duration-300">{rich(block.text)}</p> : null}
      </div>
    )
  },
  "checklist": ({ block }) => {
    const [done, setDone] = React.useState<readonly number[]>([])
    return (
      <ul className="space-y-2.5">
        {block.items.map((item, index) => {
          const checked = done.includes(index)
          return (
            <li key={index}>
              <label className="flex cursor-pointer items-start gap-2.5">
                <Checkbox className="mt-0.5" checked={checked} onCheckedChange={() => setDone(checked ? done.filter((other) => other !== index) : [...done, index])} />
                <span className={cn(checked && "text-muted-foreground line-through")}>{rich(item)}</span>
              </label>
            </li>
          )
        })}
      </ul>
    )
  },
  "walkthrough": ({ block }) => {
    const [step, setStep] = React.useState(0)
    const item = block.items[step]
    return (
      <div className="rounded-xl border bg-card p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-primary">Step {step + 1} of {block.items.length}</p>
        {/* Keyed so each step fades in. */}
        <div key={step} className="min-h-24 py-2 animate-in fade-in-0 slide-in-from-right-2 duration-300">
          <p className="text-lg font-semibold">{rich(item.title)}</p>
          <p className="mt-1 leading-relaxed text-muted-foreground">{rich(item.text)}</p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" disabled={step === 0} onClick={() => setStep(step - 1)}><ChevronLeftIcon /> Back</Button>
          <div className="flex gap-1.5" aria-hidden>
            {block.items.map((_, index) => <span key={index} className={cn("size-2 rounded-full", index === step ? "bg-primary" : "bg-border")} />)}
          </div>
          <Button size="sm" disabled={step === block.items.length - 1} onClick={() => setStep(step + 1)}>Next <ChevronRightIcon /></Button>
        </div>
      </div>
    )
  },
  "flip-cards": ({ block }) => {
    const [turned, setTurned] = React.useState<readonly number[]>([])
    return (
      <div className="grid gap-3 @min-[400px]:grid-cols-2">
        {block.items.map((item, index) => {
          const back = turned.includes(index)
          return (
            <button
              key={index}
              type="button"
              aria-pressed={back}
              className={cn("relative min-h-28 rounded-xl border p-4 text-center shadow-xs transition-colors", back ? "border-primary/40 bg-accent" : "bg-card hover:bg-muted")}
              onClick={() => setTurned(back ? turned.filter((other) => other !== index) : [...turned, index])}
            >
              <RotateCcwIcon className="absolute right-2 top-2 size-3.5 text-muted-foreground" />
              {/* Keyed so the new side animates in when the card is turned. */}
              <span key={String(back)} className={cn("block animate-in fade-in-0 zoom-in-95 duration-300", back ? "text-sm leading-relaxed" : "font-medium")}>
                {rich(back ? item.back : item.front)}
              </span>
            </button>
          )
        })}
      </div>
    )
  },
}
