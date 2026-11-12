import { LIATIR_SCRIPT_FIELD_NAME, type LiatirFieldSchema } from '@liatir/core';

/**
 * One editable line of a Script's inputs or outputs. The editor keeps an ordered list rather than
 * the saved name-keyed object, so a new field can exist with no name yet and a rename never
 * reorders or merges fields. `id` only keys the list; it is never saved.
 */
export interface ScriptContractRow {
  id: string;
  name: string;
  field: LiatirFieldSchema;
}

export type ScriptContractKind = 'input' | 'output';

export function contractRows(schema: Record<string, LiatirFieldSchema>): ScriptContractRow[] {
  return Object.entries(schema).map(([name, field]) => ({ id: crypto.randomUUID(), name, field }));
}

/** What is wrong with a row's name, in plain words, or null when it can be saved. */
export function contractNameProblem(row: ScriptContractRow, rows: ScriptContractRow[], kind: ScriptContractKind): string | null {
  const name = row.name.trim();
  if (!name) return `Give this ${kind} a name.`;
  if (!LIATIR_SCRIPT_FIELD_NAME.test(name)) return 'Use only letters, numbers and _, and do not start with a number.';
  if (rows.some((other) => other !== row && other.name.trim() === name)) return `Another ${kind} already uses this name.`;
  return null;
}

/** The saved contract; refuses, with the first problem, rather than dropping an unnamed field. */
export function contractSchema(rows: ScriptContractRow[], kind: ScriptContractKind): Record<string, LiatirFieldSchema> {
  for (const row of rows) {
    const problem = contractNameProblem(row, rows, kind);
    if (problem) throw new Error(`${kind === 'input' ? 'Inputs' : 'Outputs'}: ${problem}`);
  }
  return Object.fromEntries(rows.map((row) => [row.name.trim(), row.field]));
}
