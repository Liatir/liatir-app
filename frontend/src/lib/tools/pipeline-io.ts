// Shared helpers describing what each pipeline node *exposes* as connectable
// outputs, and which of those an upstream node makes available to a downstream
// node. This is the single source of truth behind the in-node "compatible
// inputs" pickers — so every node needs only ONE input + ONE output handle and
// the actual field-to-output wiring happens via `@pipe:` tokens, not per-field
// handles.

import type { Node, Edge } from '@xyflow/svelte';
import { resolveStepEntry } from './pipeline-registry';
import { apiConnections } from '$lib/stores/apiConnections.svelte';
import type { PickerItem } from '$lib/components/ui/OptionPicker.svelte';
import { matchesAcceptedExtension } from '$lib/utils/file-extensions';

export interface NodeOutput {
  /** Key used in the `@pipe:nodeId:key` reference token. */
  key: string;
  label: string;
  kind: 'file' | 'value';
  /** For file outputs — primary extension (used to match a downstream `accept`). */
  ext?: string;
  /** For value outputs. */
  valueType?: 'number' | 'string' | 'boolean' | 'json';
}

/** Human label for a node (used as the picker sublabel / source name). */
export function nodeDisplayLabel(n: Node): string {
  switch (n.type) {
    case 'tool':        return resolveStepEntry((n.data?.stepId as string) ?? '')?.definition.label ?? 'Tool';
    case 'variable':    return 'Variable';
    case 'math':        return 'Math';
    case 'api-request': return (n.data?.requestName as string) || 'API Request';
    case 'sub-pipeline':return (n.data?.pipelineName as string) || 'Sub-Pipeline';
    default:            return n.type ?? 'Node';
  }
}

/** Enumerate the connectable outputs a node produces. */
export function nodeOutputs(node: Node): NodeOutput[] {
  switch (node.type) {
    case 'tool': {
      const def = resolveStepEntry((node.data?.stepId as string) ?? '')?.definition;
      if (!def) return [];
      const out: NodeOutput[] = [];
      for (const [key, s] of Object.entries(def.outputSchema)) {
        if (s.type === 'file')        out.push({ key, label: s.label ?? key, kind: 'file', ext: s.ext?.[0] });
        else if (s.type === 'number') out.push({ key, label: s.label ?? key, kind: 'value', valueType: 'number' });
        else if (s.type === 'boolean') out.push({ key, label: s.label ?? key, kind: 'value', valueType: 'boolean' });
        else if (s.type === 'json')    out.push({ key, label: s.label ?? key, kind: 'value', valueType: 'json' });
        else if (s.type === 'string')  out.push({ key, label: s.label ?? key, kind: 'value', valueType: 'string' });
        // 'stats' is a rich report — not connectable.
      }
      return out;
    }
    case 'variable':
      return [{ key: 'value', label: 'Value', kind: 'value', valueType: node.data?.varType === 'number' ? 'number' : 'string' }];
    case 'math':
      return [{ key: 'result', label: 'Result', kind: 'value', valueType: 'number' }];
    case 'api-request': {
      const rid = (node.data?.requestId as string | null) ?? null;
      const req = rid ? apiConnections.requestById(rid) : null;
      const out: NodeOutput[] = [
        { key: 'status',       label: 'HTTP status',   kind: 'value', valueType: 'number' },
        { key: 'responseBody', label: 'Response body',  kind: 'file',  ext: 'json' },
      ];
      for (const [k, f] of Object.entries(req?.outputSchema ?? {})) {
        out.push({ key: k, label: f.label || k, kind: 'value', valueType: 'string' });
      }
      return out;
    }
    // condition → control-flow only; start / sub-pipeline → nothing enumerable.
    default:
      return [];
  }
}

/**
 * Picker items for outputs produced by nodes wired into `targetId` (an edge
 * source → targetId). Only outputs matching `want` (file vs value) are returned;
 * optionally narrowed by file `accept` or numeric `valueType`.
 */
export function upstreamOptions(
  targetId: string,
  nodes: Node[],
  edges: Edge[],
  want: 'file' | 'value',
  opts: { accept?: string[]; valueType?: 'number' | 'string' } = {}
): PickerItem[] {
  const upstreamIds = new Set(edges.filter(e => e.target === targetId).map(e => e.source));
  const items: PickerItem[] = [];
  for (const n of nodes) {
    if (!upstreamIds.has(n.id)) continue;
    const src = nodeDisplayLabel(n);
    for (const o of nodeOutputs(n)) {
      if (o.kind !== want) continue;
      if (want === 'file' && opts.accept?.length && o.ext && !matchesAcceptedExtension(`file.${o.ext}`, opts.accept)) continue;
      if (want === 'value' && opts.valueType === 'number' && o.valueType !== 'number') continue;
      items.push({
        value: `@pipe:${n.id}:${o.key}`,
        label: o.label,
        sublabel: src,
        badge: want === 'file' ? (o.ext ?? 'file') : (o.valueType ?? 'value'),
      });
    }
  }
  return items;
}
