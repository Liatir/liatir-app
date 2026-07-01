export function splitPreloadLog(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}
