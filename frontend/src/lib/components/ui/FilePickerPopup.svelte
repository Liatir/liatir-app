<script lang="ts">
  import OptionPicker from './OptionPicker.svelte';
  import type { DataFile } from '$lib/stores/dataFiles.svelte';
  import { fmtBytes } from '$lib/utils';

  interface Props {
    files: DataFile[];
    value: string;
    placeholder?: string;
    label?: string;
    emptyHref?: string;
    emptyText?: string;
    disabled?: boolean;
    onchange: (path: string) => void;
  }

  let {
    files,
    value,
    placeholder = 'Select a file…',
    label,
    emptyHref = '/data',
    emptyText = 'No files in Data yet.',
    disabled = false,
    onchange,
  }: Props = $props();

  function truncatePath(path: string, max = 52): string {
    if (path.length <= max) return path;
    const parts = path.split(/[\\/]/);
    return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : '…' + path.slice(-(max - 1));
  }

  const groups = $derived([{
    items: files.map(f => ({
      value: f.path,
      label: f.name,
      sublabel: truncatePath(f.path),
      badge: f.ext || '?',
      meta: f.size != null ? fmtBytes(f.size) : undefined,
    })),
  }]);
</script>

<OptionPicker
  {value}
  {groups}
  {label}
  {placeholder}
  searchPlaceholder="Search files…"
  {emptyText}
  {emptyHref}
  {disabled}
  {onchange}
/>
