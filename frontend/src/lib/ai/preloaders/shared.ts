/**
 * Turns a preloader script's raw output into displayable log lines.
 *
 * Handles both `\n` and `\r\n` (the scripts run on different platforms), and drops blank lines so
 * the install log the user watches stays dense rather than padded with empty rows.
 */
export function splitPreloadLog(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}
