/**
 * A very small schema builder for the Stage page format. One definition gives three things that therefore
 * cannot drift apart: the JSON Schema the model is held to while it writes (Ollama turns it into a
 * grammar, so the answer always has this shape), the check run on the answer, and the TypeScript type
 * the renderers receive.
 */
export type Json = { [key: string]: unknown }

export interface Field<T, Optional extends boolean = false> {
  json: Json
  optional: Optional
  /** Carries the TypeScript type only; never set. */
  readonly _type?: T
}

type AnyField = Field<unknown, boolean>
export type Fields = Record<string, AnyField>
export type TypeOf<F> = F extends Field<infer T, boolean> ? T : never
type Flatten<T> = { [K in keyof T]: T[K] } & {}
export type Shape<P extends Fields> = Flatten<
  { [K in keyof P as P[K] extends Field<unknown, true> ? never : K]: TypeOf<P[K]> } &
  { [K in keyof P as P[K] extends Field<unknown, true> ? K : never]?: TypeOf<P[K]> }
>

export const field = <T>(json: Json): Field<T> => ({ json, optional: false })

export const text = (): Field<string> => field({ type: "string", minLength: 1 })
export const number = (): Field<number> => field({ type: "number" })
export const whole = (minimum: number, maximum: number): Field<number> => field({ type: "integer", minimum, maximum })
export const flag = (): Field<boolean> => field({ type: "boolean" })
export const choice = <const V extends readonly string[]>(...values: V): Field<V[number]> => field({ type: "string", enum: values })
export const list = <T>(item: Field<T, boolean>, minItems: number, maxItems: number): Field<T[]> =>
  field({ type: "array", items: item.json, minItems, maxItems })
export const optional = <T>(value: Field<T, boolean>): Field<T, true> => ({ ...value, optional: true })

/** Required properties come first in the written JSON, in the order given here, then the optional ones. */
export const object = <P extends Fields>(properties: P): Field<Shape<P>> => field({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties).filter((key) => !properties[key].optional),
  properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, value.json])),
})

/** One of two shapes, under a name the model's guide explains once. */
export const either = <A, B>(name: string, first: Field<A, boolean>, second: Field<B, boolean>): Field<A | B> =>
  field({ anyOf: [first.json, second.json], "x-name": name })

export interface Problem {
  /** Where in the document, e.g. `sections[1].blocks[0].items`. */
  path: string
  message: string
}

const typeTag = (schema: Json): unknown => ((schema.properties as Json | undefined)?.type as Json | undefined)?.const

/** Every concrete alternative of a schema, following `$ref` and nested `anyOf`. */
function alternatives(schema: Json, defs: Json): Json[] {
  if (typeof schema.$ref === "string") return alternatives(defs[schema.$ref.slice("#/$defs/".length)] as Json, defs)
  if (Array.isArray(schema.anyOf)) return (schema.anyOf as Json[]).flatMap((option) => alternatives(option, defs))
  return [schema]
}

function shortList(values: unknown[]): string {
  const shown = values.slice(0, 30).map((value) => JSON.stringify(value)).join(", ")
  return values.length > 30 ? `${shown}, …` : shown
}

/** Collects every place where `value` does not follow `schema` (the subset of JSON Schema used above). */
export function findProblems(schema: Json, value: unknown, path: string, defs: Json, problems: Problem[] = []): Problem[] {
  const fail = (message: string) => { problems.push({ path, message }); return problems }
  const options = alternatives(schema, defs)
  if (options.length > 1) {
    if (options.every((option) => typeTag(option) !== undefined)) {
      // Elements say what they are in `type`, so a problem can be reported against the right definition.
      const type = (value as Json | null)?.type
      const match = options.find((option) => typeTag(option) === type)
      return match ? findProblems(match, value, path, defs, problems) : fail(`has no known type (${JSON.stringify(type)}); use one of: ${shortList(options.map(typeTag))}`)
    }
    const attempts = options.map((option) => findProblems(option, value, path, defs))
    problems.push(...attempts.reduce((best, attempt) => (attempt.length < best.length ? attempt : best)))
    return problems
  }
  const [rule] = options
  if ("const" in rule) return value === rule.const ? problems : fail(`must be ${JSON.stringify(rule.const)}`)
  switch (rule.type) {
    case "string":
      if (typeof value !== "string" || !value.trim()) return fail("must be text and not empty")
      if (Array.isArray(rule.enum) && !rule.enum.includes(value)) return fail(`is ${JSON.stringify(value)} but must be one of: ${shortList(rule.enum)}`)
      return problems
    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) return fail("must be a number")
      if (rule.type === "integer" && !Number.isInteger(value)) return fail("must be a whole number")
      const { minimum, maximum } = rule as { minimum?: number; maximum?: number }
      if ((minimum !== undefined && value < minimum) || (maximum !== undefined && value > maximum)) return fail(`must be from ${minimum} to ${maximum}`)
      return problems
    }
    case "boolean":
      return typeof value === "boolean" ? problems : fail("must be true or false")
    case "array": {
      if (!Array.isArray(value)) return fail("must be a list")
      const { minItems = 0, maxItems = Infinity } = rule as { minItems?: number; maxItems?: number }
      if (value.length < minItems) fail(`needs at least ${minItems} ${minItems === 1 ? "entry" : "entries"}`)
      if (value.length > maxItems) fail(`can have at most ${maxItems} entries (it has ${value.length})`)
      value.forEach((item, index) => findProblems(rule.items as Json, item, `${path}[${index}]`, defs, problems))
      return problems
    }
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return fail("must be an object with named fields")
      const properties = rule.properties as Record<string, Json>
      for (const key of rule.required as string[]) {
        if ((value as Json)[key] === undefined) problems.push({ path, message: `is missing "${key}"` })
      }
      // Unknown fields are ignored: nothing reads them.
      for (const [key, item] of Object.entries(value)) {
        if (properties[key] && item !== undefined) findProblems(properties[key], item, path ? `${path}.${key}` : key, defs, problems)
      }
      return problems
    }
  }
  return problems
}
