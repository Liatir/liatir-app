/**
 * Exporting a viewer as a PNG, by asking the OS to photograph it.
 *
 * The capture is done natively rather than in the page, because these viewers draw with WebGL and a
 * canvas. An in-page DOM snapshot would produce an image with the plot missing — which is precisely
 * the part the user wants to export. The Rust side does the actual work; see
 * `bridge/visual_capture.rs`.
 */
import { liatir } from '$lib/api';

export interface VisualCaptureResult {
	path: string;
}

/**
 * A readable, sortable, collision-free filename: `protein-structure-2026-07-12T10-31-04-123Z.png`.
 *
 * Slugged from the viewer's title so the user recognises the file, timestamped so exporting the same
 * view twice does not overwrite the first. The `:` and `.` of an ISO timestamp are replaced because
 * they are not safe in filenames on every platform.
 */
export function screenshotFilename(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	return `${slug || 'visualization'}-${stamp}.png`;
}

/**
 * Captures the on-screen rectangle occupied by an element.
 *
 * The coordinates are the element's *live* position in the viewport, so what gets captured is exactly
 * what the user is looking at — including whatever they panned, zoomed or rotated the viewer to. The
 * backend translates these logical coordinates into physical screen pixels.
 *
 * Returns `null` outside the desktop app, where there is no OS to ask.
 */
export async function captureElementRegionNative(
	element: HTMLElement,
	filename: string
): Promise<VisualCaptureResult | null> {
	const api = liatir();
	if (!api) return null;

	// A zero-sized rect means the element is hidden or not laid out yet — capturing it would save an
	// empty image, so fail with something the user can understand instead.
	const rect = element.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) {
		throw new Error('Capture region is empty.');
	}

	return await api.invoke('lia_visual_capture_region', {
		x: rect.left,
		y: rect.top,
		width: rect.width,
		height: rect.height,
		filename
	}) as VisualCaptureResult;
}
