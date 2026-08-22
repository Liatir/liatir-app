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
 * Both currently have no subject. STAR was the only requirement carrying
 * `wrongToolPatterns` and `homebrewLinkConflict`, and it left the catalogue on
 * 2026-08-22 with the other tools no code referenced. They are kept rather than
 * deleted because the hazard has not gone anywhere: `java` in particular is the
 * classic case — several JVMs, several versions, and Homebrew happy to shadow
 * one with another. Populating it needs patterns matched against real `--version`
 * output, not guessed, which is why this is empty and not wrong.
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
  packageManagerInstallCommand,
  packageManagerUpdateCommand,
} from './package-manager';
export type {
  DependencyResolution,
  DependencyResolverAction,
  DependencyResolverCommand,
  DependencyResolverEnvironment,
  DependencyResolverInput,
  DependencyResolverMessage,
} from './types';
export { wrongToolMessage } from './wrong-tool';
