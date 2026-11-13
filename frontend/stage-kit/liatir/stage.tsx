/**
 * What every element renderer shares: the tables of the presentation's sources, inline text styling,
 * icons, and the line under each data element that says where its numbers came from.
 */
import * as React from "react"
import {
  ActivityIcon, AtomIcon, BeakerIcon, BookOpenIcon, BrainIcon, BugIcon, ChartColumnIcon, CircleCheckIcon, ClockIcon, CpuIcon, DatabaseIcon,
  DnaIcon, DropletIcon, FileTextIcon, FlaskConicalIcon, FunnelIcon, GlobeIcon, HeartPulseIcon, InfoIcon, KeyRoundIcon, LayersIcon, LeafIcon,
  LightbulbIcon, LockIcon, MicroscopeIcon, PillIcon, PuzzleIcon, RocketIcon, ScaleIcon, SearchIcon, SettingsIcon, ShieldCheckIcon, SparklesIcon,
  StarIcon, SyringeIcon, TargetIcon, ThermometerIcon, TrendingDownIcon, TrendingUpIcon, TriangleAlertIcon, UsersIcon, ZapIcon, type LucideIcon,
} from "lucide-react"
import { Badge } from "../ui/badge"
import type { Origin } from "../spec/data"
import type { BlockOf, BlockType, ICONS } from "../spec/page"
import type { SourceTable } from "../spec/tables"

export interface Stage {
  tables: readonly SourceTable[]
  /** Whether the presentation is about Results at all; decides how typed numbers are labelled. */
  hasSources: boolean
}

export const StageContext = React.createContext<Stage>({ tables: [], hasSources: false })
export const useStage = () => React.useContext(StageContext)

/** One renderer per element type; `elements/index.tsx` checks that none is missing. */
export type Renderers<K extends BlockType> = { [T in K]: (props: { block: BlockOf<T> }) => React.ReactNode }

/** Text with the three inline styles the guide promises: **bold**, *italic* and `code`. */
export function rich(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).map((part, index) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{part.slice(1, -1)}</code>
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>
    return part
  })
}

const ICON_COMPONENTS = {
  "atom": AtomIcon, "beaker": BeakerIcon, "flask": FlaskConicalIcon, "microscope": MicroscopeIcon, "dna": DnaIcon, "pill": PillIcon,
  "syringe": SyringeIcon, "heart": HeartPulseIcon, "brain": BrainIcon, "leaf": LeafIcon, "bug": BugIcon, "droplet": DropletIcon,
  "thermometer": ThermometerIcon, "activity": ActivityIcon, "chart": ChartColumnIcon, "target": TargetIcon, "scale": ScaleIcon,
  "filter": FunnelIcon, "search": SearchIcon, "layers": LayersIcon, "database": DatabaseIcon, "file": FileTextIcon, "cpu": CpuIcon,
  "settings": SettingsIcon, "lightbulb": LightbulbIcon, "sparkles": SparklesIcon, "zap": ZapIcon, "rocket": RocketIcon, "star": StarIcon,
  "puzzle": PuzzleIcon, "key": KeyRoundIcon, "lock": LockIcon, "shield": ShieldCheckIcon, "book": BookOpenIcon, "clock": ClockIcon,
  "users": UsersIcon, "globe": GlobeIcon, "check": CircleCheckIcon, "warning": TriangleAlertIcon, "info": InfoIcon,
  "trending-up": TrendingUpIcon, "trending-down": TrendingDownIcon,
} satisfies Record<(typeof ICONS)[number], LucideIcon>

export function Icon({ name, className }: { name: (typeof ICONS)[number]; className?: string }) {
  const Component = ICON_COMPONENTS[name]
  return <Component className={className} aria-hidden />
}

/**
 * Says where shown numbers came from. Read from a table: the Result and table are named. Typed by the
 * model: a visible label, because such numbers are not measurements — "Illustrative" on a page about a
 * topic, "AI-entered" on a page about Results. The kit adds this itself; it is not left to the model.
 */
export function Sourced({ origin }: { origin: Origin }) {
  const { hasSources } = useStage()
  if (origin.table) {
    return <p className="text-xs text-muted-foreground">Source: {origin.table.result} · {origin.table.label}{origin.note ? ` · ${origin.note}` : ""}</p>
  }
  return hasSources
    ? <Badge variant="outline" className="text-muted-foreground" title="Typed by the AI, not read from your Results. Check it against the source.">AI-entered</Badge>
    : <Badge variant="outline" className="text-muted-foreground" title="An example written by the AI, not a measurement.">Illustrative</Badge>
}

/** A data element with its optional title above and its source line below. */
export function Figure({ title, origin, children }: { title?: string; origin: Origin; children: React.ReactNode }) {
  return (
    <figure className="space-y-2">
      {title ? <figcaption className="text-sm font-medium text-foreground">{title}</figcaption> : null}
      {children}
      <Sourced origin={origin} />
    </figure>
  )
}
