/**
 * Runs every dependency resolver and merges what they diagnose.
 *
 * Adding a new diagnosis means writing a resolver and listing it below — nothing else in the app
 * changes.
 */
import { homebrewLinkConflictResolver } from './homebrew-link-conflict';
import { wrongToolResolver } from './wrong-tool';
import type {
  DependencyResolution,
  DependencyResolver,
  DependencyResolverInput,
} from './types';

/**
 * Order matters: it decides which message the user reads first, and which fix is offered first.
 * `wrongTool` comes first because "this is not the program you think it is" reframes everything
 * else — a link conflict is beside the point if the binary on PATH is a different tool entirely.
 *
 * `wrongTool` now answers for `java`, which took over from STAR as the subject of this subsystem
 * when STAR left the catalogue on 2026-08-22. It carries no `wrongToolPatterns`: no rival program
 * answers to the name `java`, and a JVM too old for the requirement is already caught by the version
 * bounds. Its hazard is the opposite shape — a stub that reports nothing — so it is declared with
 * `versionMustBeDetectable` instead.
 *
 * `homebrewLinkConflict` has no subject at all. Java is not one: Homebrew's `openjdk` is keg-only by
 * design (`:shadowed_by_macos`), so it never loses a name race, and `brew unlink`/`brew link` is not
 * the fix for it. Leaving it unused is a decision to revisit, not an oversight.
 */
const DEPENDENCY_RESOLVERS: DependencyResolver[] = [
  wrongToolResolver,
  homebrewLinkConflictResolver,
];

/**
 * Collects the diagnosis for one dependency: every message and every offered fix.
 *
 * All resolvers run — this is not a first-match dispatch — because a dependency can be broken in
 * more than one way at once, and the user should see all of it rather than discovering the second
 * problem only after fixing the first.
 *
 * Deduplication by ID is what makes that safe: two resolvers reaching the same conclusion (a shared
 * "install it with Homebrew" action, say) surface it once, not twice.
 */
export function resolveDependency(input: DependencyResolverInput): DependencyResolution {
  const resolution: DependencyResolution = { messages: [], actions: [] };
  const seenMessages = new Set<string>();
  const seenActions = new Set<string>();

  for (const resolver of DEPENDENCY_RESOLVERS) {
    const partial = resolver(input);
    if (!partial) continue;

    // First occurrence wins, which is why resolver order above determines precedence.
    for (const message of partial.messages) {
      if (seenMessages.has(message.id)) continue;
      seenMessages.add(message.id);
      resolution.messages.push(message);
    }
    for (const action of partial.actions) {
      if (seenActions.has(action.id)) continue;
      seenActions.add(action.id);
      resolution.actions.push(action);
    }
  }

  return resolution;
}

export {
  dependencyOwner,
  packageManagerInstallCommand,
  packageManagerUpdateCommand,
} from './package-manager';
export type { DependencyOwner } from './package-manager';
export type {
  DependencyResolution,
  DependencyResolverAction,
  DependencyResolverCommand,
  DependencyResolverEnvironment,
  DependencyResolverInput,
  DependencyResolverMessage,
} from './types';
export { wrongToolMessage } from './wrong-tool';
