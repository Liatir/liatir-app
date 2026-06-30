<script lang="ts">
  import OptionPicker from './OptionPicker.svelte';
  import type { DataFile } from '$lib/stores/dataFiles.svelte';
  import { fmtBytes, getLastSegmentsStringFromPath } from '$lib/utils';

  interface Props {
    files: DataFile[];
    value: string;
    placeholder?: string;
    label?: string;
    info?: string;
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
    info,
    emptyHref = '/data',
    emptyText = 'No files in Data yet.',
    disabled = false,
    onchange,
  }: Props = $props();

  const groups = $derived([{
    items: files.map(f => ({
      value: f.path,
      label: f.name,
      sublabel: getLastSegmentsStringFromPath(f.path, 2),
      badge: f.ext || '?',
      meta: f.size != null ? fmtBytes(f.size) : undefined,
    })),
  }]);
</script>

<OptionPicker
  {value}
  {groups}
  {label}
  {info}
  {placeholder}
  searchPlaceholder="Search files…"
  {emptyText}
  {emptyHref}
  {disabled}
  {onchange}
/>
