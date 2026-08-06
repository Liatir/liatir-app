import type { ConditionNodeData, ConditionOperator } from '$lib/types/pipeline';
import type { SelectOption } from '$lib/components/ui/Select.svelte';

export const CONDITION_OPERATOR_OPTIONS: SelectOption[] = [
  { value: 'exists', label: 'Has a value' },
  { value: 'empty', label: 'Is empty' },
  { value: 'equals', label: 'Equals' },
  { value: 'not-equals', label: 'Does not equal' },
  { value: 'contains', label: 'Contains text' },
  { value: 'greater-than', label: 'Greater than' },
  { value: 'greater-or-equal', label: 'Greater or equal' },
  { value: 'less-than', label: 'Less than' },
  { value: 'less-or-equal', label: 'Less or equal' },
  { value: 'truthy', label: 'Is true' },
  { value: 'falsy', label: 'Is false' },
];

const COMPARISON_OPERATORS = new Set<ConditionOperator>([
  'equals',
  'not-equals',
  'contains',
  'greater-than',
  'greater-or-equal',
  'less-than',
  'less-or-equal',
]);

const NUMERIC_OPERATORS = new Set<ConditionOperator>([
  'greater-than',
  'greater-or-equal',
  'less-than',
  'less-or-equal',
]);

export function defaultConditionData(): ConditionNodeData {
  return { valueRef: '', operator: 'exists', compareValue: '' };
}

export function conditionNeedsCompareValue(operator: ConditionOperator | undefined): boolean {
  return !!operator && COMPARISON_OPERATORS.has(operator);
}

export function isConditionConfigured(data: Partial<ConditionNodeData> | undefined): boolean {
  if (!data) return false;
  if (data.operator) {
    if (conditionNeedsCompareValue(data.operator)) return (data.compareValue ?? '').trim() !== '';
    return true;
  }
  return !!data.condition?.trim();
}

function valueText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function valueBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const text = valueText(value).trim().toLowerCase();
  if (!text || text === 'false' || text === '0' || text === 'no' || text === 'null') return false;
  return true;
}

function compareAsNumbers(value: unknown, compareValue: string): { value: number; compare: number } | null {
  const numberValue = Number(valueText(value));
  const numberCompare = Number(compareValue);
  if (!Number.isFinite(numberValue) || !Number.isFinite(numberCompare)) return null;
  return { value: numberValue, compare: numberCompare };
}

function evaluateLegacyCondition(condition: string | undefined, value: unknown): { ok: boolean; error?: string } {
  if (!condition?.trim()) return { ok: false };
  try {
    // Legacy saved pipelines may still contain a raw JS expression. New condition
    // nodes use the no-code operator path below.
    // eslint-disable-next-line no-new-func
    return { ok: Boolean(new Function('value', `return (${condition})`)(value)) };
  } catch (error) {
    return { ok: false, error: `Invalid condition: ${error}` };
  }
}

export function evaluateConditionNode(data: ConditionNodeData, value: unknown): { ok: boolean; error?: string } {
  const operator = data.operator;
  if (!operator) return evaluateLegacyCondition(data.condition, value);

  const text = valueText(value);
  const compareValue = data.compareValue ?? '';

  switch (operator) {
    case 'exists':
      return { ok: text.trim() !== '' };
    case 'empty':
      return { ok: text.trim() === '' };
    case 'equals':
      return { ok: text === compareValue };
    case 'not-equals':
      return { ok: text !== compareValue };
    case 'contains':
      return { ok: text.toLowerCase().includes(compareValue.toLowerCase()) };
    case 'truthy':
      return { ok: valueBool(value) };
    case 'falsy':
      return { ok: !valueBool(value) };
    default: {
      if (!NUMERIC_OPERATORS.has(operator)) return { ok: false, error: 'Unsupported condition operator.' };
      const numbers = compareAsNumbers(value, compareValue);
      if (!numbers) return { ok: false, error: 'This condition needs numeric values.' };
      if (operator === 'greater-than') return { ok: numbers.value > numbers.compare };
      if (operator === 'greater-or-equal') return { ok: numbers.value >= numbers.compare };
      if (operator === 'less-than') return { ok: numbers.value < numbers.compare };
      return { ok: numbers.value <= numbers.compare };
    }
  }
}
