/**
 * How each data element gets its numbers: typed by the model, or read from a table of the frozen
 * Results. The check and the renderers both go through `readers`, so what is accepted is exactly what
 * can be drawn, and a value read from a table is always the saved one, never a retyped copy.
 */
import type { BlockOf, BlockType, NumbersData, PointsData, RowsData, SamplesData, SeriesData, ValueData } from "./page"
import { toNumber, type Cell, type SourceTable } from "./tables"

/** A problem with an element's data, worded for the model's repair and for the user. */
export class DataError extends Error {}

function fail(message: string): never {
  throw new DataError(message)
}

/** Where shown values come from. No table means the model typed them. */
export interface Origin {
  table?: SourceTable
  /** What was done to the table's rows, e.g. "highest 30 of 412 rows". */
  note?: string
}

type Tables = readonly SourceTable[]
export interface NamedValues { name: string; values: number[] }

/** Rows a chart draws from a table unless the model asks for another limit. */
const CHART_ROWS = 30
const MAX_POINTS = 3000
const MAX_GROUPS = 12

function tableOf(id: string, tables: Tables): SourceTable {
  return tables.find((table) => table.id === id) ?? fail(`there is no table ${id}`)
}

function columnOf(table: SourceTable, name: string): number {
  const index = table.columns.indexOf(name)
  return index >= 0 ? index : fail(`table ${table.id} has no column "${name}"; its columns are: ${table.columns.slice(0, 40).map((column) => `"${column}"`).join(", ")}`)
}

function numbersIn(table: SourceTable, name: string): (number | null)[] {
  const index = columnOf(table, name)
  const values = table.rows.map((row) => toNumber(row[index]))
  if (values.every((value) => value === null)) fail(`column "${name}" of ${table.id} holds text, not numbers`)
  return values
}

const present = (value: number | null): value is number => value !== null
const joined = (...notes: (string | false)[]) => notes.filter(Boolean).join("; ") || undefined
const leftOut = (count: number, column?: string) =>
  count > 0 && `${count} ${count === 1 ? "row" : "rows"} without a number${column ? ` in "${column}"` : ""} left out`

/** Labels with one or more number series, for bars, lines, pies, heatmaps and funnels. */
export function series(data: SeriesData, tables: Tables): { labels: string[]; series: NamedValues[]; origin: Origin; axis?: string } {
  if (!("table" in data)) {
    for (const item of data.series) {
      if (item.values.length !== data.labels.length) fail(`series "${item.name}" has ${item.values.length} values for ${data.labels.length} labels`)
    }
    return { labels: data.labels, series: data.series, origin: {} }
  }
  const table = tableOf(data.table, tables)
  const names = columnOf(table, data.x)
  const columns = data.y.map((name) => numbersIn(table, name))
  const complete = table.rows.map((_, index) => index).filter((index) => columns.every((values) => values[index] !== null))
  if (!complete.length) fail(`no row of ${table.id} has numbers in every y column`)
  if (data.sort) complete.sort((a, b) => (columns[0][a]! - columns[0][b]!) * (data.sort === "descending" ? -1 : 1))
  const shown = complete.slice(0, data.limit ?? CHART_ROWS)
  const which = data.sort === "descending" ? "highest" : data.sort === "ascending" ? "lowest" : "first"
  return {
    labels: shown.map((index) => String(table.rows[index][names] ?? "")),
    series: data.y.map((name, position) => ({ name, values: shown.map((index) => columns[position][index]!) })),
    origin: { table, note: joined(shown.length < complete.length && `${which} ${shown.length} of ${complete.length} rows`, leftOut(table.rows.length - complete.length)) },
    axis: data.x,
  }
}

/** Exactly one series, for elements that cannot show more. */
function one<T extends { series: NamedValues[] }>(result: T, element: string): T {
  if (result.series.length !== 1) fail(`${element} shows one series, but ${result.series.length} were given: keep one column in "y" or one entry in "series"`)
  return result
}

/** Points on two number axes, optionally split into groups by a text column. */
export function points(data: PointsData, tables: Tables): { series: { name: string; points: { x: number; y: number }[] }[]; origin: Origin; xLabel?: string; yLabel?: string } {
  if (!("table" in data)) {
    return {
      series: data.series.map((item) => {
        if (item.x.length !== item.y.length) fail(`series "${item.name}" has ${item.x.length} x values and ${item.y.length} y values`)
        return { name: item.name, points: item.x.map((x, index) => ({ x, y: item.y[index] })) }
      }),
      origin: {},
    }
  }
  const table = tableOf(data.table, tables)
  const xs = numbersIn(table, data.x)
  const ys = numbersIn(table, data.y)
  const group = data.group === undefined ? -1 : columnOf(table, data.group)
  const groups = new Map<string, { x: number; y: number }[]>()
  let drawn = 0
  let complete = 0
  table.rows.forEach((row, index) => {
    const x = xs[index]
    const y = ys[index]
    if (x === null || y === null) return
    complete++
    if (drawn >= MAX_POINTS) return
    const name = group < 0 ? data.y : String(row[group] ?? "")
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name)!.push({ x, y })
    drawn++
  })
  if (!drawn) fail(`no row of ${table.id} has numbers in both "${data.x}" and "${data.y}"`)
  if (groups.size > MAX_GROUPS) fail(`column "${data.group}" has ${groups.size} different values; a chart can colour at most ${MAX_GROUPS} groups`)
  return {
    series: [...groups].map(([name, items]) => ({ name, points: items })),
    origin: { table, note: joined(drawn < complete && `first ${drawn} of ${complete} points`, leftOut(table.rows.length - complete)) },
    xLabel: data.x,
    yLabel: data.y,
  }
}

/** Raw numbers per group, for histograms and box plots. `axis` names the measured column when split by groups. */
export function samples(data: SamplesData, tables: Tables): { series: NamedValues[]; origin: Origin; axis?: string } {
  if (!("table" in data)) return { series: data.series, origin: {} }
  const table = tableOf(data.table, tables)
  if (data.group === undefined) {
    const series = data.y.map((name) => ({ name, values: numbersIn(table, name).filter(present) }))
    return { series, origin: { table, note: joined(...series.map((item) => leftOut(table.rows.length - item.values.length, item.name))) } }
  }
  if (data.y.length !== 1) fail(`with "group", give exactly one y column (${data.y.length} were given)`)
  const values = numbersIn(table, data.y[0])
  const group = columnOf(table, data.group)
  const groups = new Map<string, number[]>()
  table.rows.forEach((row, index) => {
    const value = values[index]
    if (value === null) return
    const name = String(row[group] ?? "")
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name)!.push(value)
  })
  if (groups.size > MAX_GROUPS) fail(`column "${data.group}" has ${groups.size} different values; at most ${MAX_GROUPS} groups can be shown`)
  return {
    series: [...groups].map(([name, items]) => ({ name, values: items })),
    origin: { table, note: joined(`"${data.y[0]}" by "${data.group}"`, leftOut(values.filter((item) => item === null).length)) },
    axis: data.y[0],
  }
}

/** One list of numbers, optionally named one by one, for the threshold slider. */
export function numbers(data: NumbersData, tables: Tables): { name: string; values: number[]; labels?: string[]; origin: Origin } {
  if (!("table" in data)) {
    if (data.labels && data.labels.length !== data.values.length) {
      fail(`"labels" has ${data.labels.length} entries for ${data.values.length} values: give one label per value, or leave "labels" out`)
    }
    return { name: data.name, values: data.values, labels: data.labels, origin: {} }
  }
  const table = tableOf(data.table, tables)
  const values = numbersIn(table, data.column)
  const label = data.label === undefined ? -1 : columnOf(table, data.label)
  const kept = table.rows.map((_, index) => index).filter((index) => values[index] !== null)
  return {
    name: data.column,
    values: kept.map((index) => values[index]!),
    labels: label < 0 ? undefined : kept.map((index) => String(table.rows[index][label] ?? "")),
    origin: { table, note: joined(leftOut(table.rows.length - kept.length)) },
  }
}

/** Table rows. `numeric` says which columns hold only numbers, for right alignment. */
export function rows(data: RowsData, tables: Tables): { columns: string[]; rows: Cell[][]; numeric: boolean[]; origin: Origin } {
  const result = (columns: string[], cells: Cell[][], origin: Origin) => ({
    columns, rows: cells, origin,
    numeric: columns.map((_, index) => cells.every((row) => toNumber(row[index]) !== null)),
  })
  if (!("table" in data)) {
    data.rows.forEach((row, index) => {
      if (row.length !== data.columns.length) fail(`row ${index + 1} has ${row.length} cells for ${data.columns.length} columns`)
    })
    return result(data.columns, data.rows, {})
  }
  const table = tableOf(data.table, tables)
  const names = data.columns ?? table.columns
  const indexes = names.map((name) => columnOf(table, name))
  const shown = table.rows.slice(0, data.limit ?? table.rows.length)
  return result(names, shown.map((row) => indexes.map((index) => row[index] ?? "")), { table, note: joined(shown.length < table.rows.length && `first ${shown.length} of ${table.rows.length} rows`) })
}

/** Computed values are rounded for reading; a minimum or maximum is shown exactly as saved. */
function rounded(value: number): string {
  return String(Math.abs(value) >= 1000 ? Number(value.toFixed(1)) : Number(value.toPrecision(4)))
}

const STATS: Record<"min" | "max" | "mean" | "median" | "sum", (values: number[]) => string> = {
  min: (values) => String(values.reduce((a, b) => Math.min(a, b))),
  max: (values) => String(values.reduce((a, b) => Math.max(a, b))),
  sum: (values) => rounded(values.reduce((a, b) => a + b, 0)),
  mean: (values) => rounded(values.reduce((a, b) => a + b, 0) / values.length),
  median: (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    const middle = sorted.length >> 1
    return rounded(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2)
  },
}

/** One value: typed text, or a statistic computed from a table column. */
export function value(data: ValueData, tables: Tables): { text: string; origin: Origin } {
  if (typeof data === "string") return { text: data, origin: {} }
  const table = tableOf(data.table, tables)
  const described = `${data.stat} of "${data.column}"`
  if (data.stat === "count") {
    const index = columnOf(table, data.column)
    return { text: String(table.rows.filter((row) => String(row[index] ?? "").trim()).length), origin: { table, note: described } }
  }
  const values = numbersIn(table, data.column).filter(present)
  return { text: STATS[data.stat](values), origin: { table, note: joined(described, leftOut(table.rows.length - values.length)) } }
}

/** How each data element reads its data. An element not listed here has no data to resolve. */
export const readers = {
  "bar-chart": (block, tables) => series(block.data, tables),
  "line-chart": (block, tables) => series(block.data, tables),
  "heatmap": (block, tables) => series(block.data, tables),
  "pie-chart": (block, tables) => one(series(block.data, tables), "a pie chart"),
  "funnel": (block, tables) => {
    const result = one(series(block.data, tables), "a funnel")
    if (result.series[0].values.some((item) => item < 0)) fail("a funnel cannot show negative values")
    return result
  },
  "threshold": (block, tables) => numbers(block.data, tables),
  "scatter-chart": (block, tables) => points(block.data, tables),
  "histogram": (block, tables) => samples(block.data, tables),
  "box-plot": (block, tables) => samples(block.data, tables),
  "table": (block, tables) => rows(block.data, tables),
  "key-number": (block, tables) => value(block.value, tables),
} satisfies { [K in BlockType]?: (block: BlockOf<K>, tables: Tables) => unknown }
