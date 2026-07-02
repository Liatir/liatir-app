import type { DepRequirement } from '$lib/data/dep-requirements';
import type { DependencyResolver } from './types';

export function wrongToolMessage(version: string | null, req: DepRequirement | undefined): string | null {
  if (!version || !req?.wrongToolPatterns?.length) return null;
  const lower = version.toLowerCase();
  const matched = req.wrongToolPatterns.some((pattern) => lower.includes(pattern.toLowerCase()));
  return matched ? (req.wrongToolMessage ?? `Found a different tool named ${req.binary}.`) : null;
}

export const wrongToolResolver: DependencyResolver = ({ dep, requirement }) => {
  const text = wrongToolMessage(dep.version, requirement);
  if (!text) return null;
  return {
    messages: [{ id: 'wrong-tool', severity: 'warning', text }],
    actions: [],
  };
};
