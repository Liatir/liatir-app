# What Quenta builds on the Stage is a page document, not generated code

Accepted by the owner on 2026-11-13: "the form we make it fill must be very modular: many
kinds of elements, also purely aesthetic ones, laid out in a grid; versatile, yet simple
enough that the AI does not get it wrong". Corrected the same day: **it is not slides —
it is called Stage, and it is a page.**

## Decision

The Stage model no longer writes JavaScript. It fills in a **Stage page**: a JSON document
with a title and subtitle (drawn as the page's header, with an index of its sections),
**sections** shown one under the other on a single scrolling page, and a closing summary.
Each section is a grid of 1–4 columns holding typed **elements**, which the Stage kit
runtime draws in the sandboxed frame. Nothing in the format, the prompt, the UI or the docs
calls it slides; the Quenta mode is named **Stage**. Stored identifiers keep their earlier
name (`LiatirQuentaPresentation`, the `quenta-presentation` tool, the `html-presentation`
section, `quenta/presentation-threads.json`, the `/quenta/presentations` route) because
saved Results and conversations depend on them.

The format is defined once, in `frontend/stage-kit/spec/page.ts`, as a list of element
entries (a one-line use and its fields). From that single definition come:

- the **JSON Schema** sent to Ollama as `format`, so the model's answer is generated under
  a grammar and is always a complete page of that shape;
- the **guide** in the system prompt (`pageGuide`), in a compact `{ field, optional? }`
  notation;
- the **check** run on the answer (`spec/check.ts`), whose plain-language problems, each
  with its place ("Section 3, element 2 (bar-chart): …"), are the single repair request;
- the **types** the renderers receive (`liatir/elements/*.tsx`; a missing renderer is a
  compile error).

**Only what the model can fix goes to the repair**: the check's problems and errors the
frame reports. A display check that times out is never sent to the model (a page is data, so
a stall is the frame being slowed, e.g. Liatir in the background); it gets one more display
check, then fails plainly. The size check for the selected Results reserves room for **two**
answers, because the repair sends the first answer back; past the context, Ollama silently
drops the oldest message, which is the one holding the data.

**Measured values are read, never retyped.** The Results a page is about are turned into
tables (`spec/tables.ts`: table sections, summary values, key numbers), described to the
model with their columns and a few sample rows, and named `T1`, `T2`… A data element either
carries values typed by the model or names a table and its columns (and, for one value, a
statistic). The schema of each request lists only that request's tables and columns, so
the model cannot name one that does not exist; the frame reads every row from the frozen
copy of the Results. Under each data element the kit writes its source, or an
**AI-entered** (about Results) / **Illustrative** (about a topic) label when the model typed
the values. This is enforced by the kit, not left to the prompt. Wherever rows without a
number are skipped (charts, histograms, box plots, a computed key number), the source line
says how many.

The format belongs to the runtime that draws it: a saved page names its runtime by SHA-256
(`runtimeId`), so a later runtime never has to read an older page. Presentations made with
generated code keep that code and still run through the legacy path of the sandbox page.
The page is downloaded as one standalone offline HTML file (the same one Results exports);
PDF is not offered: the page is interactive and runs inside a sandboxed frame that may not
print, so a faithful PDF would need a separate rendering path.

## Why

Measured on 2026-11-12 with `qwen3.5:9b` (the Standard profile) on the previous design —
React code against the Stage kit's components: **5 of 5** answers (three requests, two of
them repaired once) had JavaScript syntax errors, so nothing would have opened. The model
chose the right components; it could not close ~6,000 characters of nested calls. With
the document format, Ollama's grammar makes a syntax error impossible and the remaining
problems (a text column charted, a quiz answer out of range) are named precisely for the
one repair. Results: see the [Liatir 1.0 ledger](../state/roadmap/liatir-1.0.md).

## Rejected

- **Slides** (a deck shown one slide at a time). Built first, rejected by the owner: the
  Stage is a page.
- **Keep code, add a parser for better repair messages.** Every first answer would still
  fail, costing a second 3–4 minute generation, and the repair also failed.
- **Free JSON without a grammar.** The model invents fields; the grammar is what makes the
  format reliable.
- **Code for interactive parts only.** Brings the syntax failures back exactly where the
  owner wanted richness. Interactivity is offered as ready elements instead (threshold
  slider, quiz, tabs as tabs/buttons/dropdown, popup, walkthrough, flip cards, checklist,
  reveal, hint, accordion).
- **Arbitrary nesting.** Containers (card, grid, tabs, popup) hold plain elements only: one
  level is enough for layout and keeps the grammar and the model's task small.
