import type { LiatirAIModelRecord } from '@liatir/core';
import { LIATIR_DOCS_URL } from '$lib/_constants';

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

export function aiModelOfficialUrl(model: LiatirAIModelRecord): string | null {
	return model.documentation?.officialUrl?.trim() || null;
}
