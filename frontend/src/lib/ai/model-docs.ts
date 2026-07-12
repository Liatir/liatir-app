/**
 * Documentation links for an AI Model.
 *
 * Two kinds, kept separate on purpose: Liatir's own docs explain how to *use* the model in this app,
 * while the official upstream page describes the model itself. A user wanting to know what Geneformer
 * is and a user wanting to know which file to feed it need different pages.
 */
import type { LiatirAIModelRecord } from '@liatir/core';
import { LIATIR_DOCS_URL } from '$lib/_constants';

/**
 * Resolves a docs path against the Liatir docs base URL.
 *
 * Registry entries store a relative path, not a full URL, so the docs site can move without every
 * model entry having to be rewritten. A malformed path yields `null` — the UI then simply omits the
 * link rather than rendering a broken one.
 */
export function resolveLiatirDocsUrl(path: string | undefined): string | null {
	if (!path?.trim()) return null;

	try {
		return new URL(path, LIATIR_DOCS_URL).toString();
	} catch (error) {
		console.error(error);
		return null;
	}
}

export function aiModelLiatirDocsUrl(model: LiatirAIModelRecord): string | null {
	return resolveLiatirDocsUrl(model.documentation?.liatirPath);
}

/** The upstream project's own page. Already absolute — it points outside Liatir entirely. */
export function aiModelOfficialUrl(model: LiatirAIModelRecord): string | null {
	return model.documentation?.officialUrl?.trim() || null;
}
