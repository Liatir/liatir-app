/** A table with sorting, search and pages. Values are shown exactly as given, never rounded. */
import * as React from "react"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, SearchIcon } from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table"
import { cn } from "../lib/utils"
import type { Cell } from "../spec/tables"

const PAGE_SIZE = 8

function compare(a: Cell | null, b: Cell | null): number {
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true })
}

/** `numeric[i]` right-aligns column i; its cells should then be numbers so sorting is by value. */
export function DataTable({ columns, rows, numeric }: { columns: string[]; rows: (Cell | null)[][]; numeric: boolean[] }) {
  const [query, setQuery] = React.useState("")
  const [sort, setSort] = React.useState<{ column: number; descending: boolean } | null>(null)
  const [page, setPage] = React.useState(0)

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle ? rows.filter((row) => row.some((value) => String(value ?? "").toLowerCase().includes(needle))) : rows
    if (!sort) return filtered
    const sorted = [...filtered].sort((a, b) => compare(a[sort.column], b[sort.column]))
    return sort.descending ? sorted.reverse() : sorted
  }, [rows, query, sort])
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)

  function toggleSort(column: number) {
    setSort((previous) => previous?.column === column ? (previous.descending ? null : { column, descending: true }) : { column, descending: false })
  }

  return (
    <div className="space-y-3">
      {rows.length > PAGE_SIZE ? (
        <div className="relative max-w-xs">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} />
        </div>
      ) : null}
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((label, column) => {
                const SortIcon = sort?.column !== column ? ArrowUpDownIcon : sort.descending ? ArrowDownIcon : ArrowUpIcon
                return (
                  <TableHead key={column} className={cn(numeric[column] && "text-right")}>
                    <button type="button" className="inline-flex items-center gap-1 font-medium hover:text-foreground" onClick={() => toggleSort(column)}>
                      {label}
                      <SortIcon className="size-3.5 opacity-60" />
                    </button>
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length ? visible.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((row, index) => (
              <TableRow key={index}>
                {columns.map((_, column) => (
                  <TableCell key={column} className={cn(numeric[column] && "text-right tabular-nums")}>{String(row[column] ?? "")}</TableCell>
                ))}
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={columns.length} className="py-6 text-center text-muted-foreground">No rows.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <span>Page {current + 1} of {pages}</span>
          <Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>Next</Button>
        </div>
      ) : null}
    </div>
  )
}
