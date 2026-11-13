/** Elements that show numbers: key numbers, charts, tables and the threshold slider. */
import * as React from "react"
import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react"
import { Card, CardContent } from "../../ui/card"
import { Progress } from "../../ui/progress"
import { Slider } from "../../ui/slider"
import { readers } from "../../spec/data"
import { toNumber } from "../../spec/tables"
import { BarChart, BoxPlot, Chart, Heatmap, Histogram, LineChart, PieChart, ScatterChart, binValues, chartColor } from "../charts"
import { DataTable } from "../table"
import { Figure, Sourced, rich, useStage, type Renderers } from "../stage"

const TRENDS = { up: TrendingUpIcon, down: TrendingDownIcon, flat: MinusIcon }

/** The value-axis title of a chart with one series: its name. With several, the legend names them. */
const soleName = (series: { name: string }[]) => (series.length === 1 ? series[0].name : undefined)

/** A slider step of 1, 2 or 5 times a power of ten, giving roughly fifty stops across the range. */
function sliderStep(range: number): number {
  if (!(range > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(range / 50))
  const unit = range / 50 / power
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power
}

/** Up to this many numbers the threshold draws one bar each; more are grouped into ranges. */
const THRESHOLD_BARS = 60

/** Removes binary floating-point noise such as 0.30000000000000004. */
const tidy = (value: number) => Number(value.toPrecision(10))

export const data: Renderers<
  "key-number" | "progress" | "bar-chart" | "line-chart" | "pie-chart" | "scatter-chart" | "histogram" | "box-plot" | "heatmap" | "funnel" | "table" | "threshold"
> = {
  "key-number": ({ block }) => {
    const { text, origin } = readers["key-number"](block, useStage().tables)
    const Trend = block.trend ? TRENDS[block.trend] : null
    return (
      <Card className="gap-1 py-5">
        <CardContent className="space-y-1.5">
          <p className="text-sm text-muted-foreground">{block.label}</p>
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-3xl font-semibold tracking-tight text-foreground">
            {text}
            {block.unit ? <span className="text-base font-normal text-muted-foreground">{block.unit}</span> : null}
            {Trend ? <Trend className="ml-1 size-5 self-center text-primary" /> : null}
          </p>
          {block.note ? <p className="text-xs text-muted-foreground">{rich(block.note)}</p> : null}
          {/* A typed value without digits is a name, not a measurement, and needs no label. */}
          {origin.table || /\d/.test(text) ? <Sourced origin={origin} /> : null}
        </CardContent>
      </Card>
    )
  },
  "progress": ({ block }) => (
    <div className="space-y-3">
      {block.items.map((item, index) => {
        const percent = Math.min(100, Math.max(0, item.percent))
        return (
          <div key={index} className="space-y-1.5">
            <div className="flex justify-between gap-3 text-sm">
              <span>{item.label}</span>
              <span className="tabular-nums text-muted-foreground">{percent}%</span>
            </div>
            <Progress value={percent} />
          </div>
        )
      })}
      <Sourced origin={{}} />
    </div>
  ),
  "bar-chart": ({ block }) => {
    const { labels, series, origin, axis } = readers["bar-chart"](block, useStage().tables)
    return (
      <Figure title={block.title} origin={origin}>
        <BarChart labels={labels} series={series} horizontal={block.horizontal} stacked={block.stacked} unit={block.unit} categoryLabel={axis} valueLabel={soleName(series)} />
      </Figure>
    )
  },
  "line-chart": ({ block }) => {
    const { labels, series, origin, axis } = readers["line-chart"](block, useStage().tables)
    return (
      <Figure title={block.title} origin={origin}>
        <LineChart labels={labels} series={series} area={block.area} unit={block.unit} xLabel={axis} yLabel={soleName(series)} />
      </Figure>
    )
  },
  "pie-chart": ({ block }) => {
    const { labels, series, origin } = readers["pie-chart"](block, useStage().tables)
    return <Figure title={block.title} origin={origin}><PieChart labels={labels} values={series[0].values} /></Figure>
  },
  "scatter-chart": ({ block }) => {
    const { series, origin, xLabel, yLabel } = readers["scatter-chart"](block, useStage().tables)
    return <Figure title={block.title} origin={origin}><ScatterChart series={series} xLabel={block.xLabel ?? xLabel} yLabel={block.yLabel ?? yLabel} /></Figure>
  },
  "histogram": ({ block }) => {
    const { series, origin, axis } = readers["histogram"](block, useStage().tables)
    return <Figure title={block.title} origin={origin}><Histogram series={series} bins={block.bins} xLabel={axis ?? soleName(series)} /></Figure>
  },
  "box-plot": ({ block }) => {
    const { series, origin } = readers["box-plot"](block, useStage().tables)
    return <Figure title={block.title} origin={origin}><BoxPlot groups={series} yLabel={block.unit} /></Figure>
  },
  "heatmap": ({ block }) => {
    const { labels, series, origin } = readers["heatmap"](block, useStage().tables)
    const values = labels.map((_, row) => series.map((item) => item.values[row]))
    return <Figure title={block.title} origin={origin}><Heatmap rows={labels} columns={series.map((item) => item.name)} values={values} unit={block.unit} /></Figure>
  },
  "funnel": ({ block }) => {
    const { labels, series, origin } = readers["funnel"](block, useStage().tables)
    const values = series[0].values
    const widest = Math.max(...values) || 1
    return (
      <Figure title={block.title} origin={origin}>
        <div className="space-y-1.5">
          {labels.map((label, index) => (
            <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-3">
              <span className="truncate text-right text-sm" title={label}>{label}</span>
              <div className="flex justify-center">
                <div
                  className="flex h-9 min-w-fit items-center justify-center rounded-md bg-primary px-2 text-sm font-medium tabular-nums text-primary-foreground"
                  style={{ width: `${(values[index] / widest) * 100}%`, opacity: Math.max(0.45, 1 - index * 0.12) }}
                >
                  {values[index].toLocaleString("en-US", { maximumFractionDigits: 20 })}{block.unit ? ` ${block.unit}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Figure>
    )
  },
  "table": ({ block }) => {
    const { columns, rows, numeric, origin } = readers["table"](block, useStage().tables)
    // Number columns are sorted by value, so their cells are given as numbers.
    const cells = rows.map((row) => row.map((value, column) => (numeric[column] ? toNumber(value) : value)))
    return <Figure title={block.title} origin={origin}><DataTable columns={columns} rows={cells} numeric={numeric} /></Figure>
  },
  "threshold": ({ block }) => {
    const { name, values, labels, origin } = readers["threshold"](block, useStage().tables)
    const low = values.reduce((a, b) => Math.min(a, b))
    const high = values.reduce((a, b) => Math.max(a, b))
    const step = sliderStep(high - low)
    const [limit, setLimit] = React.useState(() => tidy(Math.round((low + high) / 2 / step) * step))
    const passes = (value: number) => (block.pass === "below" ? value <= limit : value >= limit)
    // A bar per number while they fit; beyond that, ranges coloured by whether their middle passes.
    const ranges = values.length > THRESHOLD_BARS ? binValues([values], 20) : null
    const bars = ranges
      ? { labels: ranges.labels, data: ranges.counts[0], passing: ranges.centres.map(passes), x: name, y: "Count" }
      : { labels: labels ?? values.map((_, index) => String(index + 1)), data: values, passing: values.map(passes), x: undefined, y: name }
    return (
      <Figure origin={origin}>
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{block.label}</span>
            <span className="text-sm tabular-nums text-muted-foreground">
              {block.pass === "below" ? "at most" : "at least"} {limit}{block.unit ? ` ${block.unit}` : ""}
            </span>
          </div>
          <Slider
            aria-label={block.label}
            value={[limit]} step={step}
            min={tidy(Math.floor(low / step) * step)} max={tidy(Math.ceil(high / step) * step)}
            onValueChange={([next]) => setLimit(tidy(next))}
          />
          <p className="text-sm text-muted-foreground">
            <span className="text-2xl font-semibold text-primary">{values.filter(passes).length}</span> of {values.length} pass
          </p>
          <Chart
            type="bar"
            height={240}
            data={{ labels: bars.labels, datasets: [{ label: bars.y, data: bars.data, borderRadius: 4, backgroundColor: bars.passing.map((pass) => (pass ? chartColor(0) : "#d4d4d8")) }] }}
            // Redrawn on every slider move, so it must not animate. Unnamed numbers show no axis labels.
            options={{
              animation: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { title: { display: Boolean(bars.x), text: bars.x }, grid: { display: false }, ticks: { display: Boolean(ranges || labels) } },
                // Bars always grow from zero, so their lengths compare honestly.
                y: { beginAtZero: true, title: { display: true, text: bars.y }, ...(ranges ? { ticks: { precision: 0 } } : {}) },
              },
            }}
          />
        </div>
      </Figure>
    )
  },
}
