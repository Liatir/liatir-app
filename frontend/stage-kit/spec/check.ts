/**
 * The check between the model's answer and the frame: is it a complete page, does it follow the
 * format, and can every data element really get its numbers? Each problem is one plain sentence that
 * says where it is, so the single repair request can name exactly what to fix.
 */
import { DataError, readers } from "./data"
import { pageFormat, type Block, type Page } from "./page"
import { findProblems, type Json } from "./schema"
import type { SourceTable } from "./tables"

/** Problems reported in one repair request; more than this and the list stops helping. */
const MAX_PROBLEMS = 12

/** Drops empty optional values, which mean "not given". A required field left empty is then reported as missing. */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== "").map(([key, item]) => [key, prune(item)]))
}

/** `sections[1].blocks[0].data.y[0]` as "Section 2, element 1, data.y[0]". */
function place(path: string): string {
  const match = /^sections\[(\d+)\](?:\.blocks\[(\d+)\])?\.?(.*)$/.exec(path)
  if (!match) return path || "The page"
  const [, section, element, rest] = match
  return [`Section ${Number(section) + 1}`, element !== undefined && `element ${Number(element) + 1}`, rest].filter(Boolean).join(", ")
}

/** Every element of a page with the place it is in, containers before what they hold. */
function* elements(page: Page): Generator<{ block: Block; at: string }> {
  for (const [sectionIndex, section] of page.sections.entries()) {
    for (const [index, block] of section.blocks.entries()) {
      const at = `Section ${sectionIndex + 1}, element ${index + 1}`
      yield { block, at }
      const inner = block.type === "tabs" ? block.tabs.flatMap((tab) => tab.blocks) : "blocks" in block ? block.blocks : []
      for (const [position, child] of inner.entries()) yield { block: child, at: `${at}, inner element ${position + 1}` }
    }
  }
}

function dataProblem(block: Block, tables: readonly SourceTable[]): string | undefined {
  if (block.type === "quiz" && block.answer > block.options.length) return `answer is ${block.answer} but there are only ${block.options.length} options`
  const read = (readers as Partial<Record<Block["type"], (block: never, tables: readonly SourceTable[]) => unknown>>)[block.type]
  if (!read) return undefined
  try {
    read(block as never, tables)
    return undefined
  } catch (error) {
    if (error instanceof DataError) return error.message
    throw error
  }
}

export interface CheckedPage {
  /** Present only when there are no problems. */
  page?: Page
  problems: string[]
}

export function checkPage(answer: string, tables: readonly SourceTable[]): CheckedPage {
  let parsed: unknown
  try {
    parsed = JSON.parse(answer)
  } catch {
    return { problems: ["The answer is not complete JSON: it was cut off, probably for being too long. Write a shorter page."] }
  }
  const value = prune(parsed)
  const schema = pageFormat(tables)
  const problems = findProblems(schema, value, "", schema.$defs as Json).map((problem) => `${place(problem.path)} ${problem.message}.`)
  if (problems.length) return { problems: problems.slice(0, MAX_PROBLEMS) }
  const page = value as Page
  for (const { block, at } of elements(page)) {
    const problem = dataProblem(block, tables)
    if (problem) problems.push(`${at} (${block.type}): ${problem}.`)
  }
  return problems.length ? { problems: problems.slice(0, MAX_PROBLEMS) } : { page, problems }
}
