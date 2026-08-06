import { EditorView, hoverTooltip } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import { Compartment, type Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { LIATIR_API } from './liatir-completions.generated';
import type { ResolvedTheme } from './stores/settings.svelte';

/**
 * CodeMirror styles itself with literal colours rather than our CSS tokens, so
 * light and dark are two full palettes here. The `syntax`/`ui` split keeps each
 * theme a plain data description; the styles below are built from it once.
 */
type EditorPalette = {
  dark: boolean;
  syntax: {
    keyword: string; operator: string; punctuation: string; bracket: string;
    comment: string; string: string; number: string; literal: string;
    variable: string; definition: string; func: string; invalid: string;
  };
  ui: {
    background: string; text: string; gutterBg: string; gutterText: string;
    border: string; tooltipBg: string; tooltipText: string; detailText: string;
    activeLine: string; activeLineGutter: string; infoBg: string; infoText: string;
  };
};

const LIGHT_PALETTE: EditorPalette = {
  dark: false,
  syntax: {
    keyword: '#6d28d9', operator: '#374151', punctuation: '#9ca3af', bracket: '#6b7280',
    comment: '#9ca3af', string: '#047857', number: '#b45309', literal: '#b91c1c',
    variable: '#1f2937', definition: '#012723', func: '#1d4ed8', invalid: '#dc2626',
  },
  ui: {
    background: '#ffffff', text: '#1f2937', gutterBg: '#f8f8fa', gutterText: '#a1a1aa',
    border: '#e2e2e8', tooltipBg: '#ffffff', tooltipText: '#1f2937', detailText: '#9ca3af',
    activeLine: 'rgba(0,0,0,0.025)', activeLineGutter: 'rgba(0,0,0,0.03)',
    infoBg: '#f8f8fa', infoText: '#6b7280',
  },
};

// Mirrors the dark tokens in app.css; syntax hues are the lighter shades of the
// same families so they stay legible on a dark background.
const DARK_PALETTE: EditorPalette = {
  dark: true,
  syntax: {
    keyword: '#c4b5fd', operator: '#d4d4d8', punctuation: '#71717a', bracket: '#a1a1aa',
    comment: '#71717a', string: '#6ee7b7', number: '#fcd34d', literal: '#fca5a5',
    variable: '#e4e4e7', definition: '#5eead4', func: '#93c5fd', invalid: '#f87171',
  },
  ui: {
    background: '#1c1c20', text: '#e4e4e7', gutterBg: '#18181b', gutterText: '#52525b',
    border: '#2a2a30', tooltipBg: '#232328', tooltipText: '#e4e4e7', detailText: '#71717a',
    activeLine: 'rgba(255,255,255,0.035)', activeLineGutter: 'rgba(255,255,255,0.05)',
    infoBg: '#18181b', infoText: '#a1a1aa',
  },
};

// ── Syntax highlight colours ────────────────────────────────────────────────

function buildHighlightStyle(p: EditorPalette) {
  const s = p.syntax;
  return HighlightStyle.define([
    { tag: tags.keyword,                          color: s.keyword, fontWeight: '500' },
    { tag: tags.controlKeyword,                   color: s.keyword, fontWeight: '500' },
    { tag: tags.operatorKeyword,                  color: s.keyword },
    { tag: tags.operator,                         color: s.operator },
    { tag: tags.punctuation,                      color: s.punctuation },
    { tag: tags.bracket,                          color: s.bracket },
    { tag: tags.comment,                          color: s.comment, fontStyle: 'italic' },
    { tag: tags.lineComment,                      color: s.comment, fontStyle: 'italic' },
    { tag: tags.blockComment,                     color: s.comment, fontStyle: 'italic' },
    { tag: tags.string,                           color: s.string },
    { tag: tags.special(tags.string),             color: s.string },
    { tag: tags.number,                           color: s.number },
    { tag: tags.bool,                             color: s.literal },
    { tag: tags.null,                             color: s.literal },
    { tag: tags.regexp,                           color: s.string },
    { tag: tags.variableName,                     color: s.variable },
    { tag: tags.definition(tags.variableName),    color: s.definition },
    { tag: tags.function(tags.variableName),      color: s.func },
    { tag: tags.function(tags.propertyName),      color: s.func },
    { tag: tags.propertyName,                     color: s.string },
    { tag: tags.typeName,                         color: s.definition },
    { tag: tags.className,                        color: s.definition },
    { tag: tags.namespace,                        color: s.definition },
    { tag: tags.self,                             color: s.literal },
    { tag: tags.atom,                             color: s.literal },
    { tag: tags.invalid,                          color: s.invalid },
  ]);
}

// ── Editor view theme ───────────────────────────────────────────────────────

function buildViewTheme(p: EditorPalette) {
  const { ui, syntax } = p;
  // The brand accent (caret, selection, matched completion) is identical in both
  // themes — it reads well on either background.
  return EditorView.theme({
    '&': { height: '100%', fontSize: '13px', backgroundColor: ui.background },
    '.cm-scroller': {
      fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
      lineHeight: '1.75',
      overflow: 'auto',
    },
    '.cm-content': { padding: '14px 0', caretColor: '#0A948B', color: ui.text },
    '.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#0A948B', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgba(10, 148, 139, 0.14)',
    },
    '::selection': { backgroundColor: 'rgba(10, 148, 139, 0.14)' },
    '.cm-activeLine': { backgroundColor: ui.activeLine },
    '.cm-activeLineGutter': { backgroundColor: ui.activeLineGutter },
    '.cm-gutters': {
      backgroundColor: ui.gutterBg,
      borderRight: `1px solid ${ui.border}`,
      color: ui.gutterText,
      userSelect: 'none',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 16px 0 8px',
      minWidth: '44px',
      textAlign: 'right',
      fontSize: '12px',
    },
    '.cm-tooltip': {
      backgroundColor: ui.tooltipBg,
      border: `1px solid ${ui.border}`,
      borderRadius: '8px',
      boxShadow: p.dark ? '0 8px 24px rgba(0,0,0,0.5)' : '0 8px 24px rgba(0,0,0,0.12)',
      color: ui.tooltipText,
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
      color: p.dark ? '#5eead4' : '#012723',
    },
    '.cm-completionLabel': { color: ui.tooltipText },
    '.cm-completionDetail': {
      color: ui.detailText,
      fontStyle: 'italic',
      paddingLeft: '10px',
      fontSize: '11px',
    },
    '.cm-completionMatchedText': {
      color: p.dark ? '#5eead4' : '#0A948B',
      textDecoration: 'none',
      fontWeight: 'bold',
    },
    '.cm-completionInfo': {
      padding: '8px 12px',
      backgroundColor: ui.infoBg,
      borderTop: `1px solid ${ui.border}`,
      color: ui.infoText,
      fontSize: '11px',
      fontFamily: 'system-ui, sans-serif',
      maxWidth: '320px',
      lineHeight: '1.5',
    },
    '.cm-matchingBracket': {
      color: `${syntax.definition} !important`,
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
    '.cm-liatir-hover-symbol': { color: syntax.string },
    '.cm-liatir-hover-detail': { color: p.dark ? '#5eead4' : '#0A948B', paddingLeft: '6px' },
    '.cm-liatir-hover-info':   { color: ui.infoText, fontFamily: 'system-ui, sans-serif', fontSize: '11px', marginTop: '4px' },
  }, { dark: p.dark });
}

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

const THEMES: Record<ResolvedTheme, Extension> = {
  light: [buildViewTheme(LIGHT_PALETTE), syntaxHighlighting(buildHighlightStyle(LIGHT_PALETTE))],
  dark: [buildViewTheme(DARK_PALETTE), syntaxHighlighting(buildHighlightStyle(DARK_PALETTE))],
};

/**
 * Theme lives in a compartment so it can be swapped on a live editor via
 * `reconfigureTheme`, instead of rebuilding the view and losing undo history,
 * cursor position, and scroll.
 */
export const liatirThemeCompartment = new Compartment();

export const liatirTheme = (theme: ResolvedTheme = 'light'): Extension =>
  liatirThemeCompartment.of(THEMES[theme]);

/** Applies a theme change to an editor that is already mounted. */
export function reconfigureTheme(view: EditorView, theme: ResolvedTheme) {
  view.dispatch({ effects: liatirThemeCompartment.reconfigure(THEMES[theme]) });
}

export const liatirCompletions = autocompletion({
  override: [liatirCompletionSource],
  defaultKeymap: true,
  activateOnTyping: true,
});

export const liatirHover = liatirHoverTooltip;
