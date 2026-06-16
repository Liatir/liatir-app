import { EditorView, hoverTooltip } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import { OFFLAB_API } from './offlab-completions.generated';

// ── Syntax highlight colours ────────────────────────────────────────────────

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword,                          color: '#a09af9', fontWeight: '500' },
  { tag: tags.controlKeyword,                   color: '#a09af9', fontWeight: '500' },
  { tag: tags.operatorKeyword,                  color: '#a09af9' },
  { tag: tags.operator,                         color: '#d4d4d8' },
  { tag: tags.punctuation,                      color: '#71717a' },
  { tag: tags.bracket,                          color: '#a1a1aa' },
  { tag: tags.comment,                          color: '#52525e', fontStyle: 'italic' },
  { tag: tags.lineComment,                      color: '#52525e', fontStyle: 'italic' },
  { tag: tags.blockComment,                     color: '#52525e', fontStyle: 'italic' },
  { tag: tags.string,                           color: '#6ee7b7' },
  { tag: tags.special(tags.string),             color: '#6ee7b7' },
  { tag: tags.number,                           color: '#fbbf24' },
  { tag: tags.bool,                             color: '#fb923c' },
  { tag: tags.null,                             color: '#fb923c' },
  { tag: tags.regexp,                           color: '#6ee7b7' },
  { tag: tags.variableName,                     color: '#e4e4e8' },
  { tag: tags.definition(tags.variableName),    color: '#c4bffb' },
  { tag: tags.function(tags.variableName),      color: '#93c5fd' },
  { tag: tags.function(tags.propertyName),      color: '#93c5fd' },
  { tag: tags.propertyName,                     color: '#86efac' },
  { tag: tags.typeName,                         color: '#c4bffb' },
  { tag: tags.className,                        color: '#c4bffb' },
  { tag: tags.namespace,                        color: '#c4bffb' },
  { tag: tags.self,                             color: '#fb923c' },
  { tag: tags.atom,                             color: '#fb923c' },
  { tag: tags.invalid,                          color: '#f87171' },
]);

// ── Editor view theme ───────────────────────────────────────────────────────

const viewTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': {
    fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
    lineHeight: '1.75',
    overflow: 'auto',
  },
  '.cm-content': { padding: '14px 0', caretColor: '#4f39f6' },
  '.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#4f39f6', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(79, 57, 246, 0.25)',
  },
  '::selection': { backgroundColor: 'rgba(79, 57, 246, 0.3)' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.025)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)' },
  '.cm-gutters': {
    backgroundColor: '#17171a',
    borderRight: '1px solid #2e2e35',
    color: '#52525e',
    userSelect: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 16px 0 8px',
    minWidth: '44px',
    textAlign: 'right',
    fontSize: '12px',
  },
  '.cm-tooltip': {
    backgroundColor: '#1f1f23',
    border: '1px solid #2e2e35',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
    color: '#e4e4e8',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    fontSize: '12px',
    maxHeight: '200px',
  },
  '.cm-tooltip-autocomplete ul li': { padding: '4px 10px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'rgba(79, 57, 246, 0.22)',
    color: '#c4bffb',
  },
  '.cm-completionLabel': { color: '#e4e4e8' },
  '.cm-completionDetail': {
    color: '#71717a',
    fontStyle: 'italic',
    paddingLeft: '10px',
    fontSize: '11px',
  },
  '.cm-completionMatchedText': {
    color: '#a09af9',
    textDecoration: 'none',
    fontWeight: 'bold',
  },
  '.cm-completionInfo': {
    padding: '8px 12px',
    backgroundColor: '#28282e',
    borderTop: '1px solid #2e2e35',
    color: '#a1a1aa',
    fontSize: '11px',
    fontFamily: 'system-ui, sans-serif',
    maxWidth: '320px',
    lineHeight: '1.5',
  },
  '.cm-matchingBracket': {
    color: '#c4bffb !important',
    fontWeight: 'bold',
    outline: '1px solid rgba(79, 57, 246, 0.4)',
    borderRadius: '2px',
  },
  // Hover tooltip
  '.cm-offlab-hover': {
    padding: '8px 12px',
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    fontSize: '12px',
    lineHeight: '1.6',
    maxWidth: '420px',
  },
  '.cm-offlab-hover-symbol': { color: '#86efac' },
  '.cm-offlab-hover-detail': { color: '#a09af9', paddingLeft: '6px' },
  '.cm-offlab-hover-info':   { color: '#a1a1aa', fontFamily: 'system-ui, sans-serif', fontSize: '11px', marginTop: '4px' },
}, { dark: true });

// ── ApiNode type (exported so the generated file can reference it) ───────────

export type ApiNode = {
  type: 'property' | 'method' | 'variable';
  detail: string;
  info?: string;
  children?: Record<string, ApiNode>;
};

// ── Completion resolution ───────────────────────────────────────────────────

function resolveNode(parts: string[]): Record<string, ApiNode> | null {
  if (parts.length === 0) return OFFLAB_API;
  let node: ApiNode | undefined = OFFLAB_API[parts[0]];
  for (let i = 1; i < parts.length; i++) {
    if (!node?.children) return null;
    node = node.children[parts[i]];
  }
  return node?.children ?? null;
}

function offlabCompletionSource(context: CompletionContext) {
  const dotMatch = context.matchBefore(/Offlab(\.\w*)*/);

  if (!dotMatch) {
    const word = context.matchBefore(/\w+/);
    if (!word || !word.text.startsWith('Off')) return null;
    return {
      from: word.from,
      options: [{ label: 'Offlab', type: 'variable' as const, detail: 'Offlab bridge API' }],
      validFor: /^\w*$/,
    };
  }

  const text    = dotMatch.text;
  const lastDot = text.lastIndexOf('.');

  if (lastDot === -1) {
    return {
      from: dotMatch.from,
      options: [{ label: 'Offlab', type: 'variable' as const, detail: 'Offlab bridge API' }],
      validFor: /^\w*$/,
    };
  }

  const prefix = text.slice(0, lastDot);
  const from   = dotMatch.from + lastDot + 1;
  const parts  = prefix.split('.').slice(1); // drop "Offlab"

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
  prefix = 'Offlab',
  out = new Map<string, ApiNode>()
): Map<string, ApiNode> {
  for (const [key, node] of Object.entries(tree)) {
    const full = `${prefix}.${key}`;
    out.set(full, node);
    if (node.children) buildSymbolMap(node.children, full, out);
  }
  return out;
}

const SYMBOL_MAP = buildSymbolMap(OFFLAB_API);

const offlabHoverTooltip = hoverTooltip((view, pos) => {
  const line    = view.state.doc.lineAt(pos);
  const lineStr = line.text;
  const col     = pos - line.from;

  // Find the longest "Offlab.xxx.yyy" token covering pos
  let best: { from: number; to: number; symbol: string } | null = null;
  const re = /Offlab(?:\.\w+)*/g;
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
      wrap.className = 'cm-offlab-hover';

      const firstLine = document.createElement('div');
      const sym  = document.createElement('span');
      sym.className = 'cm-offlab-hover-symbol';
      sym.textContent = best!.symbol;
      const det  = document.createElement('span');
      det.className = 'cm-offlab-hover-detail';
      det.textContent = node.detail;
      firstLine.append(sym, det);
      wrap.append(firstLine);

      if (node.info) {
        const inf = document.createElement('div');
        inf.className = 'cm-offlab-hover-info';
        inf.textContent = node.info;
        wrap.append(inf);
      }

      return { dom: wrap };
    },
  };
});

// ── Exports ─────────────────────────────────────────────────────────────────

export const offlabTheme = [viewTheme, syntaxHighlighting(highlightStyle)];

export const offlabCompletions = autocompletion({
  override: [offlabCompletionSource],
  defaultKeymap: true,
  activateOnTyping: true,
});

export const offlabHover = offlabHoverTooltip;
