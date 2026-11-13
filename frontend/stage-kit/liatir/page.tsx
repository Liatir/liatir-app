/**
 * Draws a Stage page: one page that scrolls, with a header made from its title (and a short index of
 * its sections), the sections one under the other, and a closing section.
 */
import * as React from "react"
import { cn } from "../lib/utils"
import type { BACKGROUNDS, Page, Section } from "../spec/page"
import { sourceTables, type StageSource } from "../spec/tables"
import { Blocks } from "./elements"
import { StageContext, rich, type Stage } from "./stage"

const BACKDROPS: Record<(typeof BACKGROUNDS)[number], { className?: string; style?: React.CSSProperties }> = {
  plain: {},
  tint: { className: "bg-accent/50" },
  gradient: { className: "bg-linear-to-br from-accent via-background to-background" },
  dots: { style: { backgroundImage: "radial-gradient(var(--border) 1.2px, transparent 1.2px)", backgroundSize: "18px 18px" } },
  grid: { style: { backgroundImage: "linear-gradient(var(--muted) 1px, transparent 1px), linear-gradient(90deg, var(--muted) 1px, transparent 1px)", backgroundSize: "32px 32px" } },
}

/** `data-reveal` makes a section rise into view as the page scrolls (theme.css). */
function PageSection({ section, number }: { section: Section; number: number }) {
  const backdrop = BACKDROPS[section.background ?? "plain"]
  const panel = section.background !== undefined && section.background !== "plain"
  return (
    <section
      id={`section-${number}`}
      data-section={number}
      data-reveal
      style={backdrop.style}
      className={cn("scroll-mt-4 rounded-2xl", panel ? "px-4 py-8 min-[560px]:px-8" : "py-4", backdrop.className)}
    >
      <h2 className="text-2xl font-semibold tracking-tight text-foreground min-[560px]:text-3xl">{rich(section.title)}</h2>
      {section.subtitle ? <p className="mt-1.5 text-lg text-muted-foreground">{rich(section.subtitle)}</p> : null}
      <div className="mt-6"><Blocks blocks={section.blocks} columns={section.columns} /></div>
    </section>
  )
}

export function PageView({ page, sources }: { page: Page; sources: readonly StageSource[] }) {
  const stage = React.useMemo<Stage>(() => ({ tables: sourceTables(sources), hasSources: sources.length > 0 }), [sources])
  // Buttons rather than links: the page runs in a sandboxed frame, where it does not navigate at all.
  const goTo = (number: number) => document.getElementById(`section-${number}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  return (
    <StageContext.Provider value={stage}>
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-4 py-6 min-[560px]:px-8 min-[560px]:py-10">
        <header className="rounded-3xl bg-linear-to-br from-accent via-background to-background px-6 py-12 text-center min-[560px]:py-16">
          <div className="mx-auto mb-6 h-1.5 w-16 rounded-full bg-primary" />
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-foreground min-[560px]:text-5xl">{rich(page.title)}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-xl text-balance text-muted-foreground">{rich(page.subtitle)}</p>
          <nav aria-label="Sections" className="mt-8 flex flex-wrap justify-center gap-2">
            {page.sections.map((section, index) => (
              <button
                key={index}
                type="button"
                className="rounded-full border border-border bg-background/80 px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                onClick={() => goTo(index + 1)}
              >
                {section.title}
              </button>
            ))}
          </nav>
        </header>
        {page.sections.map((section, index) => <PageSection key={index} section={section} number={index + 1} />)}
        <section data-reveal className="rounded-2xl bg-accent/50 px-6 py-12 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-balance text-foreground">{rich(page.closing.title)}</h2>
          <p className="mx-auto mt-4 max-w-2xl text-xl leading-relaxed text-balance text-muted-foreground">{rich(page.closing.text)}</p>
        </section>
        {/* On the page itself, so it travels with a downloaded copy. */}
        <p className="text-center text-[11px] text-muted-foreground">AI-generated page. Check figures and conclusions against their sources.</p>
      </div>
    </StageContext.Provider>
  )
}
