/**
 * Charts for presentations, on Chart.js. Each takes plain data (labels and number series) and applies
 * Liatir's palette, fonts, axes, legend and tooltips. The element renderers pass data that the page
 * check has already accepted; the checks here are a last guard that fails loudly instead of drawing
 * something wrong.
 */
import * as React from "react"
import {
  Chart as ChartJS,
  registerables,
  type ChartConfiguration,
  type ChartData,
  type ChartOptions,
  type ChartType,
} from "chart.js"
import { MatrixController, MatrixElement } from "chartjs-chart-matrix"
import { BoxPlotController, BoxAndWiskers } from "@sgratzl/chartjs-chart-boxplot"

ChartJS.register(...registerables, MatrixController, MatrixElement, BoxPlotController, BoxAndWiskers)

const BASE_PALETTE = ["#0a948b", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444", "#10b981", "#ec4899", "#64748b"]
let palette = BASE_PALETTE

/**
 * Puts the page's accent colour first, so single-series charts match the rest of the page. `replaces`
 * is the palette entry of the same hue, dropped so two series never look alike.
 */
export function setChartAccent(color: string, replaces: number) {
  palette = [color, ...BASE_PALETTE.filter((_, index) => index !== replaces)]
}

/** The colour of the series at `index`, for drawings that should match the charts. */
export const chartColor = (index: number) => palette[index % palette.length]

ChartJS.defaults.font.family = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
ChartJS.defaults.font.size = 13
ChartJS.defaults.color = "#52525b"
ChartJS.defaults.borderColor = "#e2e2e8"
ChartJS.defaults.plugins.legend.labels.usePointStyle = true

const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item))
}

function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

function axisTitle(text?: string) {
  return text ? { display: true, text } : undefined
}

/** Value-axis labels with thousands separators and the unit. Replaces Chart.js's own formatter. */
function valueTicks(unit?: string) {
  return { callback: (value: string | number) => `${typeof value === "number" ? value.toLocaleString("en-US") : value}${unit ? ` ${unit}` : ""}` }
}

export interface ChartProps {
  type: ChartType
  data: ChartData
  options?: ChartOptions
  /** Height in pixels; the chart always fills its container's width. */
  height?: number
}

/** A Chart.js chart with Liatir defaults; the charts below are built on it. */
export function Chart({ type, data, options, height = 320 }: ChartProps) {
  check(typeof type === "string", "Chart needs a type, for example \"bar\" or \"line\".")
  check(data && Array.isArray(data.datasets), "Chart needs data.datasets, an array of datasets.")
  const canvas = React.useRef<HTMLCanvasElement>(null)
  // Recreated whenever the config changes: simple, and charts here are small.
  const config = JSON.stringify({ type, data, options }, (_key, value) => typeof value === "function" ? String(value) : value)
  React.useEffect(() => {
    if (!canvas.current) return
    const datasets = data.datasets.map((dataset, index) => {
      const color = palette[index % palette.length]
      const filled = type === "bar" || type === "pie" || type === "doughnut" || type === "polarArea"
      return {
        borderColor: color,
        backgroundColor: filled ? (type === "bar" ? withAlpha(color, 0.85) : palette) : withAlpha(color, 0.2),
        ...dataset,
      }
    })
    const chart = new ChartJS(canvas.current, {
      type,
      data: { ...data, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion ? false : { duration: 700 },
        ...options,
      },
    } as ChartConfiguration)
    return () => chart.destroy()
  }, [config])
  return (
    <div style={{ position: "relative", height }}>
      <canvas ref={canvas} role="img" aria-label={`${type} chart`} />
    </div>
  )
}

export interface Series {
  name: string
  values: number[]
}

function checkSeries(component: string, labels: unknown, series: unknown): asserts series is Series[] {
  check(Array.isArray(labels) && labels.length > 0, `${component} needs labels, a non-empty array of category names.`)
  check(Array.isArray(series) && series.length > 0, `${component} needs series: [{ name, values }].`)
  for (const item of series as Series[]) {
    check(typeof item?.name === "string", `${component}: every series needs a name.`)
    check(isNumberArray(item.values), `${component}: series "${item.name}" needs values, an array of numbers.`)
    check(item.values.length === labels.length, `${component}: series "${item.name}" has ${item.values.length} values for ${labels.length} labels.`)
  }
}

export function BarChart({ labels, series, horizontal = false, stacked = false, unit, categoryLabel, valueLabel, height }: {
  labels: string[]; series: Series[]; horizontal?: boolean; stacked?: boolean; unit?: string; categoryLabel?: string; valueLabel?: string; height?: number
}) {
  checkSeries("BarChart", labels, series)
  const valueAxis = { stacked, beginAtZero: true, title: axisTitle(valueLabel), ticks: valueTicks(unit) }
  const categoryAxis = { stacked, title: axisTitle(categoryLabel), grid: { display: false } }
  return (
    <Chart
      type="bar"
      height={height}
      data={{ labels, datasets: series.map((item) => ({ label: item.name, data: item.values, borderRadius: 6 })) }}
      options={{
        indexAxis: horizontal ? "y" : "x",
        plugins: { legend: { display: series.length > 1 } },
        scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
      }}
    />
  )
}

export function LineChart({ labels, series, area = false, unit, xLabel, yLabel, height }: {
  labels: string[]; series: Series[]; area?: boolean; unit?: string; xLabel?: string; yLabel?: string; height?: number
}) {
  checkSeries("LineChart", labels, series)
  return (
    <Chart
      type="line"
      height={height}
      data={{ labels, datasets: series.map((item) => ({ label: item.name, data: item.values, fill: area, tension: 0.3, pointRadius: 3 })) }}
      options={{
        plugins: { legend: { display: series.length > 1 } },
        scales: { x: { title: axisTitle(xLabel), grid: { display: false } }, y: { title: axisTitle(yLabel), ticks: valueTicks(unit) } },
      }}
    />
  )
}

export function ScatterChart({ series, xLabel, yLabel, height }: {
  series: { name: string; points: { x: number; y: number }[] }[]; xLabel?: string; yLabel?: string; height?: number
}) {
  check(Array.isArray(series) && series.length > 0, "ScatterChart needs series: [{ name, points: [{ x, y }] }].")
  for (const item of series) {
    check(Array.isArray(item?.points) && item.points.every((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)),
      `ScatterChart: series "${item?.name}" needs points, an array of { x, y } numbers.`)
  }
  return (
    <Chart
      type="scatter"
      height={height}
      data={{ datasets: series.map((item) => ({ label: item.name, data: item.points, pointRadius: 4 })) }}
      options={{
        plugins: { legend: { display: series.length > 1 } },
        scales: { x: { title: axisTitle(xLabel) }, y: { title: axisTitle(yLabel) } },
      }}
    />
  )
}

export function PieChart({ labels, values, donut = true, height }: { labels: string[]; values: number[]; donut?: boolean; height?: number }) {
  check(Array.isArray(labels) && labels.length > 0, "PieChart needs labels, a non-empty array of slice names.")
  check(isNumberArray(values) && values.length === labels.length, "PieChart needs values, one number per label.")
  return (
    <Chart
      type={donut ? "doughnut" : "pie"}
      height={height}
      data={{ labels, datasets: [{ data: values, borderColor: "#ffffff", borderWidth: 2 }] }}
      options={{ plugins: { legend: { position: "right" } } }}
    />
  )
}

/**
 * Counts how many values of each group fall in each of `bins` equal-width ranges. The ranges are shared
 * by all groups, so their counts can be stacked and compared.
 */
export function binValues(groups: number[][], bins: number): { labels: string[]; counts: number[][]; centres: number[] } {
  // Reduced, not spread: a column can hold more values than a call can take arguments.
  const all = groups.flat()
  const min = all.reduce((a, b) => Math.min(a, b))
  const max = all.reduce((a, b) => Math.max(a, b))
  const width = (max - min) / bins || 1
  const counts = groups.map((values) => {
    const row = new Array<number>(bins).fill(0)
    for (const value of values) row[Math.min(bins - 1, Math.floor((value - min) / width))]++
    return row
  })
  const format = (value: number) => Number(value.toPrecision(3)).toString()
  const ranges = Array.from({ length: bins }, (_, index) => index)
  return {
    labels: ranges.map((index) => `${format(min + index * width)} to ${format(min + (index + 1) * width)}`),
    counts,
    centres: ranges.map((index) => min + (index + 0.5) * width),
  }
}

/** One set of numbers, or several stacked in the same ranges with a legend naming them. */
export function Histogram({ series, bins = 10, xLabel, height }: { series: Series[]; bins?: number; xLabel?: string; height?: number }) {
  check(Array.isArray(series) && series.length > 0 && series.every((item) => isNumberArray(item?.values) && item.values.length > 0),
    "Histogram needs series: [{ name, values }] with at least one number each.")
  check(Number.isInteger(bins) && bins >= 1 && bins <= 100, "Histogram bins must be a whole number from 1 to 100.")
  const { labels, counts } = binValues(series.map((item) => item.values), bins)
  return (
    <Chart
      type="bar"
      height={height}
      data={{ labels, datasets: series.map((item, index) => ({ label: item.name, data: counts[index], barPercentage: 1, categoryPercentage: 1 })) }}
      options={{
        plugins: { legend: { display: series.length > 1 } },
        // Counts are whole numbers, so the axis has no fractional ticks.
        scales: { x: { stacked: true, title: axisTitle(xLabel), grid: { display: false } }, y: { stacked: true, beginAtZero: true, title: axisTitle("Count"), ticks: { precision: 0 } } },
      }}
    />
  )
}

export function Heatmap({ rows, columns, values, unit, height }: {
  rows: string[]; columns: string[]; values: number[][]; unit?: string; height?: number
}) {
  check(Array.isArray(rows) && rows.length > 0 && Array.isArray(columns) && columns.length > 0, "Heatmap needs rows and columns, non-empty arrays of names.")
  check(Array.isArray(values) && values.length === rows.length && values.every((row) => isNumberArray(row) && row.length === columns.length),
    `Heatmap needs values as ${rows.length} rows of ${columns.length} numbers.`)
  const flat = values.flat()
  const min = Math.min(...flat)
  const span = Math.max(...flat) - min || 1
  const cells = values.flatMap((row, y) => row.map((value, x) => ({ x: columns[x], y: rows[y], v: value })))
  return (
    <Chart
      type={"matrix" as ChartType}
      height={height ?? Math.max(200, rows.length * 36 + 60)}
      data={{
        datasets: [{
          label: unit ?? "Value",
          data: cells,
          backgroundColor: (context: { raw?: { v: number } }) => withAlpha(palette[0], 0.12 + 0.88 * (((context.raw?.v ?? min) - min) / span)),
          width: ({ chart }: { chart: ChartJS }) => (chart.chartArea?.width ?? 0) / columns.length - 2,
          height: ({ chart }: { chart: ChartJS }) => (chart.chartArea?.height ?? 0) / rows.length - 2,
        }],
      } as unknown as ChartData}
      options={{
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (item) => {
            const raw = item.raw as { x: string; y: string; v: number }
            return `${raw.y} · ${raw.x}: ${raw.v}${unit ? ` ${unit}` : ""}`
          } } },
        },
        scales: {
          x: { type: "category", labels: columns, grid: { display: false } },
          // A vertical category axis starts at the bottom, and the matrix ignores `reverse`: the names are
          // given in reverse so the first row is at the top, as in a table.
          y: { type: "category", labels: [...rows].reverse(), offset: true, grid: { display: false } },
        },
      } as ChartOptions}
    />
  )
}

export function BoxPlot({ groups, yLabel, height }: { groups: { name: string; values: number[] }[]; yLabel?: string; height?: number }) {
  check(Array.isArray(groups) && groups.length > 0, "BoxPlot needs groups: [{ name, values }].")
  for (const group of groups) {
    check(isNumberArray(group?.values) && group.values.length > 0, `BoxPlot: group "${group?.name}" needs values, a non-empty array of numbers.`)
  }
  return (
    <Chart
      type={"boxplot" as ChartType}
      height={height}
      data={{
        labels: groups.map((group) => group.name),
        datasets: [{
          label: yLabel ?? "Values",
          data: groups.map((group) => group.values),
          backgroundColor: withAlpha(palette[0], 0.25),
          borderColor: palette[0],
          borderWidth: 1.5,
        }],
      } as unknown as ChartData}
      options={{ plugins: { legend: { display: false } }, scales: { y: { title: axisTitle(yLabel) } } } as ChartOptions}
    />
  )
}
