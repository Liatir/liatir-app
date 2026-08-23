import { liatir } from '$lib/api';

// Shared copy/export helpers for log-style panels (RunRecord, JobLogViewer, …).
// Both actions go through the desktop bridge; keeping them here avoids
// duplicating the clipboard + save-to-file dance in every viewer component.

/** Copy `text` to the system clipboard. No-op when the bridge is unavailable. */
export async function copyTextToClipboard(text: string): Promise<void> {
	const api = liatir();
	await api?.desktop.clipboard.writeText(text);
}

/**
 * Prompt for a destination and write `text` there as a file.
 * Returns true when a destination was chosen and the write was issued,
 * false when the user cancelled or the bridge is unavailable.
 */
export async function saveTextToFile(defaultName: string, text: string): Promise<boolean> {
	const api = liatir();
	if (!api) return false;
	try {
		const dest = await api.desktop.files.save(defaultName);
		if (!dest) return false;
		await api.invoke('lia_write_file_path', { path: dest, content: text });
		return true;
	} catch {
		// User cancelled the save dialog, or the write failed.
		return false;
	}
}
