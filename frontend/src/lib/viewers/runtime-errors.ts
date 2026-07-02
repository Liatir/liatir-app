export function isViewerProxyCompatibilityError(message: string): boolean {
	return message.includes("Proxy handler's 'get' result");
}

export function viewerRuntimeFailureMessage(message: string, runtimeLabel: string): string {
	if (isViewerProxyCompatibilityError(message)) {
		return `The embedded ${runtimeLabel} runtime is not compatible with this webview context.`;
	}
	return message;
}
