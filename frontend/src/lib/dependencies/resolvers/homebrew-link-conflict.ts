import { wrongToolMessage } from './wrong-tool';
import type { DependencyResolver } from './types';

export const homebrewLinkConflictResolver: DependencyResolver = ({
  dep,
  requirement,
  environment,
}) => {
  const conflict = requirement?.homebrewLinkConflict;
  if (!conflict || !environment.brewAvailable) return null;
  if (!wrongToolMessage(dep.version, requirement)) return null;

  return {
    messages: [],
    actions: [
      {
        id: 'homebrew-link-conflict',
        label: conflict.actionLabel,
        variant: 'primary',
        confirmTitle: conflict.confirmTitle,
        confirmMessage: conflict.confirmMessage,
        confirmLabel: 'Resolve link',
        commands: [
          { cmd: 'brew', args: ['unlink', conflict.blockerFormula] },
          { cmd: 'brew', args: ['link', conflict.targetFormula] },
        ],
      },
    ],
  };
};
