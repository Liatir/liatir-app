<script lang="ts">
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import Icon from '@iconify/svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { getLastSegmentsStringFromPath } from '$lib/utils';
	import { captureElementRegionNative, screenshotFilename } from '$lib/viewers/visual-capture';

	interface Props {
		title: string;
		description?: string;
		badge?: string;
		height?: number;
		openHref?: string;
		openLabel?: string;
		children: Snippet;
	}

	let {
		title,
		description,
		badge,
		height = 420,
		openHref,
		openLabel = 'Open page',
		children
	}: Props = $props();

	let captureEl: HTMLDivElement | null = $state(null);
	let expanded = $state(false);
	let capturing = $state(false);
	let captureError = $state<string | null>(null);

	function collectDocumentStyles(): string {
		const chunks: string[] = [];
		for (const sheet of Array.from(document.styleSheets)) {
			try {
				const rules = Array.from(sheet.cssRules ?? []);
				chunks.push(rules.map((rule) => rule.cssText).join('\n'));
			} catch {
				// Cross-origin stylesheets cannot be read; local app styles are enough for Liatir UI captures.
			}
		}
		return chunks.join('\n');
	}

	function replaceEmbeddedFrames(root: HTMLElement) {
		for (const frame of Array.from(root.querySelectorAll('iframe'))) {
			const placeholder = document.createElement('div');
			placeholder.setAttribute(
				'style',
				'height:100%;min-height:240px;display:flex;align-items:center;justify-content:center;background:#fafafa;color:#71717a;font:12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;border:1px solid #e4e4e7;border-radius:8px;box-sizing:border-box;'
			);
			placeholder.textContent = 'Embedded viewer';
			frame.replaceWith(placeholder);
		}
	}

	function downloadDataUrl(dataUrl: string, filename: string) {
		const link = document.createElement('a');
		link.href = dataUrl;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		link.remove();
	}

	async function captureElementAsPng(element: HTMLElement, filename: string) {
		const rect = element.getBoundingClientRect();
		const width = Math.max(1, Math.ceil(rect.width));
		const height = Math.max(1, Math.ceil(rect.height));
		const clone = element.cloneNode(true) as HTMLElement;
		replaceEmbeddedFrames(clone);

		const styles = collectDocumentStyles();
		const serialized = clone.outerHTML;
		const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;background:#fff;">
      <style>${styles}</style>
      ${serialized}
    </div>
  </foreignObject>
</svg>`;

		const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
		try {
			const image = new Image();
			await new Promise<void>((resolve, reject) => {
				image.onload = () => resolve();
				image.onerror = () => reject(new Error('Could not render screenshot.'));
				image.src = url;
			});
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('Canvas capture is not available.');
			ctx.drawImage(image, 0, 0);
			downloadDataUrl(canvas.toDataURL('image/png'), filename);
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	async function captureScreenshot() {
		if (capturing) return;
		capturing = true;
		captureError = null;
		const filename = screenshotFilename(title);
		try {
			if (!captureEl) return;
			try {
				const nativeResult = await captureElementRegionNative(captureEl, filename);
				if (nativeResult?.path) {
					toast.success(`Saved screenshot: ${getLastSegmentsStringFromPath(nativeResult.path, 2)}`);
					return;
				}
			} catch (nativeError) {
				console.warn('[visual-capture] native capture failed', nativeError);
			}
			await captureElementAsPng(captureEl, filename);
			toast.success(`Saved screenshot: ${filename}`);
		} catch (err) {
			captureError = err instanceof Error ? err.message : String(err);
		} finally {
			capturing = false;
		}
	}

	function toggleExpanded() {
		expanded = !expanded;
	}

	$effect(() => {
		if (!expanded || typeof document === 'undefined') return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});
</script>

<div class={expanded ? 'fixed inset-0 z-[9980] bg-white p-4' : ''}>
	<div
		class={[
			'rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4',
			expanded ? 'flex h-full flex-col rounded-none border-0' : ''
		].join(' ')}
	>
		<div class="mb-3 flex items-start justify-between gap-3">
			<div class="min-w-0">
				<p class="truncate text-xs font-medium text-zinc-500">{title}</p>
				{#if description}
					<p class="mt-1 text-[11px] text-zinc-400">{description}</p>
				{/if}
			</div>
			<div class="flex shrink-0 items-center gap-1.5">
				{#if openHref}
					<button
						type="button"
						title={openLabel}
						aria-label={openLabel}
						class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
						onclick={() => goto(openHref)}
					>
						<Icon icon="lucide:external-link" class="h-4 w-4" />
					</button>
				{/if}
				<button
					type="button"
					title="Capture screenshot"
					aria-label="Capture screenshot"
					class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
					disabled={capturing}
					onclick={captureScreenshot}
				>
					<Icon icon={capturing ? 'lucide:loader-2' : 'lucide:camera'} class={`h-4 w-4 ${capturing ? 'animate-spin' : ''}`} />
				</button>
				<button
					type="button"
					title={expanded ? 'Close fullscreen' : 'Fullscreen'}
					aria-label={expanded ? 'Close fullscreen' : 'Fullscreen'}
					class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
					onclick={toggleExpanded}
				>
					<Icon icon={expanded ? 'lucide:minimize-2' : 'lucide:maximize-2'} class="h-4 w-4" />
				</button>
				{#if badge}
					<span class="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
						{badge}
					</span>
				{/if}
			</div>
		</div>

		{#if captureError}
			<div class="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
				{captureError}
			</div>
		{/if}

		<div
			bind:this={captureEl}
			class="min-h-0 overflow-hidden rounded-lg border border-border bg-white {expanded ? 'flex-1' : ''}"
			style={expanded ? '' : `height: ${height}px`}
		>
			{@render children()}
		</div>
	</div>
</div>
