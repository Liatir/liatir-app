/**
 * Detects a name collision: the binary exists, but it is a *different program* than the one needed.
 *
 * A real and confusing case in bioinformatics — several tools share short names, so a `bcftools` or
 * `mash` on PATH may belong to something else entirely. Detection would report it as "available", the
 * tool would then fail with a baffling error, and the user would have no way to guess why.
 *
 * The version string is the tell: the wrong program identifies itself differently when asked. So
 * matching against known signatures in its `--version` output is what distinguishes "installed" from
 * "installed, but not the one we mean".
 */
import type { DepRequirement } from '$lib/data/dep-requirements';
import type { DependencyResolver } from './types';

/**
 * Returns an explanation if the version output matches a known impostor, else `null`.
 *
 * Exported because the Homebrew resolver reuses it: a link conflict is only worth offering to fix
 * when the *symptom* is that the wrong tool is being found.
 */
export function wrongToolMessage(version: string | null, req: DepRequirement | undefined): string | null {
  if (!version || !req?.wrongToolPatterns?.length) return null;
  // Case-insensitive substring match: version banners vary in capitalisation and surrounding text.
  const lower = version.toLowerCase();
  const matched = req.wrongToolPatterns.some((pattern) => lower.includes(pattern.toLowerCase()));
  return matched ? (req.wrongToolMessage ?? `Found a different tool named ${req.binary}.`) : null;
}

/**
 * A warning with no action: this resolver can *identify* the collision but not fix it. Resolving it
 * depends on how the wrong tool got there — which is what the Homebrew resolver handles.
 */
export const wrongToolResolver: DependencyResolver = ({ dep, requirement }) => {
  const text = wrongToolMessage(dep.version, requirement);
  if (!text) return null;
  return {
    messages: [{ id: 'wrong-tool', severity: 'warning', text }],
    actions: [],
  };
};
