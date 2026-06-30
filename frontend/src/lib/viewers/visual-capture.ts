import { liatir } from '$lib/api';

export interface VisualCaptureResult {
	path: string;
}

export function screenshotFilename(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	return `${slug || 'visualization'}-${stamp}.png`;
}

export async function captureElementRegionNative(
	element: HTMLElement,
	filename: string
): Promise<VisualCaptureResult | null> {
	const api = liatir();
	if (!api) return null;

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
