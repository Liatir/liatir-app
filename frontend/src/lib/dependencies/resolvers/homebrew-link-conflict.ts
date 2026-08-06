/**
 * Fixes the specific case where Homebrew has the right tool installed but a *different* formula owns
 * the name on PATH.
 *
 * Homebrew links one formula's binary into PATH per name. When two formulae provide a binary with the
 * same name, the loser is installed but unreachable — so the tool the user needs is genuinely on the
 * machine, and Liatir still cannot run it. Reinstalling would not help; relinking would.
 *
 * Three conditions must all hold before this is offered, which is why the guards below matter:
 * the requirement must actually describe a known conflict, Homebrew must be present to act with, and
 * the observed symptom must really be "a different tool answers to this name". Offering `brew unlink`
 * on a wrong diagnosis would break a working tool.
 */
import { wrongToolMessage } from './wrong-tool';
import type { DependencyResolver } from './types';

export const homebrewLinkConflictResolver: DependencyResolver = ({
  dep,
  requirement,
  environment,
}) => {
  const conflict = requirement?.homebrewLinkConflict;
  if (!conflict || !environment.brewAvailable) return null;
  // Only act when the wrong tool is genuinely what is being found — see the note above.
  if (!wrongToolMessage(dep.version, requirement)) return null;

  return {
    // No message: `wrongToolResolver` has already explained the symptom. This adds only the fix.
    messages: [],
    actions: [
      {
        id: 'homebrew-link-conflict',
        label: conflict.actionLabel,
        variant: 'primary',
        // Confirmed, not silent: unlinking touches a formula the user may rely on outside Liatir.
        confirmTitle: conflict.confirmTitle,
        confirmMessage: conflict.confirmMessage,
        confirmLabel: 'Resolve link',
        // Order is essential: the blocker must give up the name before the target can claim it.
        commands: [
          { cmd: 'brew', args: ['unlink', conflict.blockerFormula] },
          { cmd: 'brew', args: ['link', conflict.targetFormula] },
        ],
      },
    ],
  };
};
