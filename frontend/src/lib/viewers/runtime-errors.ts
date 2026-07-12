/**
 * Translates one specific viewer crash into something a user can act on.
 *
 * Some of these libraries fail inside the webview with a raw JavaScript engine error about a Proxy
 * handler — a message that is meaningless to a biologist and does not hint that the problem is an
 * environment incompatibility rather than their data. Recognising that signature lets the UI say what
 * actually went wrong instead of surfacing the engine's internals.
 *
 * Every other message is passed through untouched: guessing at errors we do not recognise would risk
 * replacing a genuinely useful message with a wrong one.
 */
export function isViewerProxyCompatibilityError(message: string): boolean {
	return message.includes("Proxy handler's 'get' result");
}

export function viewerRuntimeFailureMessage(message: string, runtimeLabel: string): string {
	if (isViewerProxyCompatibilityError(message)) {
		return `The embedded ${runtimeLabel} runtime is not compatible with this webview context.`;
	}
	return message;
}
