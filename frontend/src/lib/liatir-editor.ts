import { EditorView, hoverTooltip } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import { LIATIR_API } from './liatir-completions.generated';

// ── Syntax highlight colours ────────────────────────────────────────────────

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword,                          color: '#6d28d9', fontWeight: '500' },
  { tag: tags.controlKeyword,                   color: '#6d28d9', fontWeight: '500' },
  { tag: tags.operatorKeyword,                  color: '#6d28d9' },
  { tag: tags.operator,                         color: '#374151' },
  { tag: tags.punctuation,                      color: '#9ca3af' },
  { tag: tags.bracket,                          color: '#6b7280' },
  { tag: tags.comment,                          color: '#9ca3af', fontStyle: 'italic' },
  { tag: tags.lineComment,                      color: '#9ca3af', fontStyle: 'italic' },
  { tag: tags.blockComment,                     color: '#9ca3af', fontStyle: 'italic' },
  { tag: tags.string,                           color: '#047857' },
  { tag: tags.special(tags.string),             color: '#047857' },
  { tag: tags.number,                           color: '#b45309' },
  { tag: tags.bool,                             color: '#b91c1c' },
  { tag: tags.null,                             color: '#b91c1c' },
  { tag: tags.regexp,                           color: '#047857' },
  { tag: tags.variableName,                     color: '#1f2937' },
  { tag: tags.definition(tags.variableName),    color: '#012723' },
  { tag: tags.function(tags.variableName),      color: '#1d4ed8' },
  { tag: tags.function(tags.propertyName),      color: '#1d4ed8' },
  { tag: tags.propertyName,                     color: '#047857' },
  { tag: tags.typeName,                         color: '#012723' },
  { tag: tags.className,                        color: '#012723' },
  { tag: tags.namespace,                        color: '#012723' },
  { tag: tags.self,                             color: '#b91c1c' },
  { tag: tags.atom,                             color: '#b91c1c' },
  { tag: tags.invalid,                          color: '#dc2626' },
]);

// ── Editor view theme ───────────────────────────────────────────────────────

const viewTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: '#ffffff' },
  '.cm-scroller': {
    fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
    lineHeight: '1.75',
    overflow: 'auto',
  },
  '.cm-content': { padding: '14px 0', caretColor: '#0A948B', color: '#1f2937' },
  '.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#0A948B', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(10, 148, 139, 0.14)',
  },
  '::selection': { backgroundColor: 'rgba(10, 148, 139, 0.14)' },
  '.cm-activeLine': { backgroundColor: 'rgba(0,0,0,0.025)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(0,0,0,0.03)' },
  '.cm-gutters': {
    backgroundColor: '#f8f8fa',
    borderRight: '1px solid #e2e2e8',
    color: '#a1a1aa',
    userSelect: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 16px 0 8px',
    minWidth: '44px',
    textAlign: 'right',
    fontSize: '12px',
  },
  '.cm-tooltip': {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e2e8',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
    color: '#1f2937',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    fontSize: '12px',
    maxHeight: '200px',
  },
  '.cm-tooltip-autocomplete ul li': { padding: '4px 10px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'rgba(10, 148, 139, 0.10)',
    color: '#012723',
  },
  '.cm-completionLabel': { color: '#1f2937' },
  '.cm-completionDetail': {
    color: '#9ca3af',
    fontStyle: 'italic',
    paddingLeft: '10px',
    fontSize: '11px',
  },
  '.cm-completionMatchedText': {
    color: '#0A948B',
    textDecoration: 'none',
    fontWeight: 'bold',
  },
  '.cm-completionInfo': {
    padding: '8px 12px',
    backgroundColor: '#f8f8fa',
    borderTop: '1px solid #e2e2e8',
    color: '#6b7280',
    fontSize: '11px',
    fontFamily: 'system-ui, sans-serif',
    maxWidth: '320px',
    lineHeight: '1.5',
  },
  '.cm-matchingBracket': {
    color: '#012723 !important',
    fontWeight: 'bold',
    outline: '1px solid rgba(10, 148, 139, 0.3)',
    borderRadius: '2px',
  },
  // Hover tooltip
  '.cm-liatir-hover': {
    padding: '8px 12px',
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    fontSize: '12px',
    lineHeight: '1.6',
    maxWidth: '420px',
  },
  '.cm-liatir-hover-symbol': { color: '#047857' },
  '.cm-liatir-hover-detail': { color: '#0A948B', paddingLeft: '6px' },
  '.cm-liatir-hover-info':   { color: '#6b7280', fontFamily: 'system-ui, sans-serif', fontSize: '11px', marginTop: '4px' },
}, { dark: false });

// ── ApiNode type (exported so the generated file can reference it) ───────────

export type ApiNode = {
  type: 'property' | 'method' | 'variable';
  detail: string;
  info?: string;
  children?: Record<string, ApiNode>;
};

// ── Completion resolution ───────────────────────────────────────────────────

function resolveNode(parts: string[]): Record<string, ApiNode> | null {
  if (parts.length === 0) return LIATIR_API;
  let node: ApiNode | undefined = LIATIR_API[parts[0]];
  for (let i = 1; i < parts.length; i++) {
    if (!node?.children) return null;
    node = node.children[parts[i]];
  }
  return node?.children ?? null;
}

function liatirCompletionSource(context: CompletionContext) {
  const dotMatch = context.matchBefore(/Liatir(\.\w*)*/);

  if (!dotMatch) {
    const word = context.matchBefore(/\w+/);
    if (!word || !word.text.startsWith('Off')) return null;
    return {
      from: word.from,
      options: [{ label: 'Liatir', type: 'variable' as const, detail: 'Liatir bridge API' }],
      validFor: /^\w*$/,
    };
  }

  const text    = dotMatch.text;
  const lastDot = text.lastIndexOf('.');

  if (lastDot === -1) {
    return {
      from: dotMatch.from,
      options: [{ label: 'Liatir', type: 'variable' as const, detail: 'Liatir bridge API' }],
      validFor: /^\w*$/,
    };
  }

  const prefix = text.slice(0, lastDot);
  const from   = dotMatch.from + lastDot + 1;
  const parts  = prefix.split('.').slice(1); // drop "Liatir"

  const children = resolveNode(parts);
  if (!children) return null;

  const options: Completion[] = Object.entries(children).map(([key, node]) => ({
    label:  key,
    type:   node.type,
    detail: node.detail,
    info:   node.info,
    boost:  node.type === 'method' ? 1 : 0,
  }));

  return { from, options, validFor: /^\w*$/ };
}

// ── Hover tooltip ───────────────────────────────────────────────────────────

// Build a flat symbol → node map for hover lookup
function buildSymbolMap(
  tree: Record<string, ApiNode>,
  prefix = 'Liatir',
  out = new Map<string, ApiNode>()
): Map<string, ApiNode> {
  for (const [key, node] of Object.entries(tree)) {
    const full = `${prefix}.${key}`;
    out.set(full, node);
    if (node.children) buildSymbolMap(node.children, full, out);
  }
  return out;
}

const SYMBOL_MAP = buildSymbolMap(LIATIR_API);

const liatirHoverTooltip = hoverTooltip((view, pos) => {
  const line    = view.state.doc.lineAt(pos);
  const lineStr = line.text;
  const col     = pos - line.from;

  // Find the longest "Liatir.xxx.yyy" token covering pos
  let best: { from: number; to: number; symbol: string } | null = null;
  const re = /Liatir(?:\.\w+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lineStr)) !== null) {
    const start = line.from + m.index;
    const end   = start + m[0].length;
    if (start <= pos && pos <= end) {
      if (!best || m[0].length > best.symbol.length) {
        best = { from: start, to: end, symbol: m[0] };
      }
    }
  }
  if (!best) return null;

  const node = SYMBOL_MAP.get(best.symbol);
  if (!node) return null;

  return {
    pos:   best.from,
    end:   best.to,
    above: true,
    create() {
      const wrap = document.createElement('div');
      wrap.className = 'cm-liatir-hover';

      const firstLine = document.createElement('div');
      const sym  = document.createElement('span');
      sym.className = 'cm-liatir-hover-symbol';
      sym.textContent = best!.symbol;
      const det  = document.createElement('span');
      det.className = 'cm-liatir-hover-detail';
      det.textContent = node.detail;
      firstLine.append(sym, det);
      wrap.append(firstLine);

      if (node.info) {
        const inf = document.createElement('div');
        inf.className = 'cm-liatir-hover-info';
        inf.textContent = node.info;
        wrap.append(inf);
      }

      return { dom: wrap };
    },
  };
});

// ── Exports ─────────────────────────────────────────────────────────────────

export const liatirTheme = [viewTheme, syntaxHighlighting(highlightStyle)];

export const liatirCompletions = autocompletion({
  override: [liatirCompletionSource],
  defaultKeymap: true,
  activateOnTyping: true,
});

export const liatirHover = liatirHoverTooltip;
