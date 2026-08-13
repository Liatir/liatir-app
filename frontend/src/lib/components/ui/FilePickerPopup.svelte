<!--
	Picks a file from the workspace's Data.

	A thin specialisation of the generic OptionPicker: it only maps files onto options and lets the picker
	do the rest. That is the intended shape — anything with a list of choices reuses OptionPicker rather
	than growing its own popup, so search, keyboard handling and the empty state behave identically
	everywhere.

	The mapping is what makes the list usable: the filename as the label, a shortened path beneath it (so
	two files with the same name are distinguishable), the extension as a badge, and the size as meta.
	The empty state links to /data, so a user with no files is told where to add them.
-->
<script lang="ts">
  import OptionPicker from './OptionPicker.svelte';
  import type { DataFile } from '$lib/stores/dataFiles.svelte';
  import { fmtBytes, getLastSegmentsStringFromPath } from '$lib/utils';
  import { artifactValidationLabel } from '$lib/scientific-artifacts';
  import { artifactCompatibility } from '$lib/scientific-artifacts';
  import type { LiatirArtifactRequirement } from '@liatir/core';

  interface Props {
    files: DataFile[];
    value: string;
    placeholder?: string;
    label?: string;
    info?: string;
    emptyHref?: string;
    emptyText?: string;
    disabled?: boolean;
    testId?: string;
    artifactRequirement?: LiatirArtifactRequirement;
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
    testId,
    artifactRequirement,
    onchange,
  }: Props = $props();

  const groups = $derived([{
    items: files.map(f => {
      const compatibility = artifactCompatibility(f.scientific, artifactRequirement);
      const firstDiagnostic = compatibility?.diagnostics[0];
      return {
        value: f.path,
        label: f.name,
        sublabel: getLastSegmentsStringFromPath(f.path, 2),
        badge: f.ext || '?',
        meta: [
          f.size != null ? fmtBytes(f.size) : null,
          artifactValidationLabel(f.scientific),
          compatibility ? `scientific I/O: ${compatibility.status}` : null,
        ].filter(Boolean).join(' · ') || undefined,
        disabled: compatibility?.status === 'incompatible',
        reason: firstDiagnostic
          ? `${firstDiagnostic.message}${firstDiagnostic.action ? ` ${firstDiagnostic.action}` : ''}`
          : undefined,
      };
    }),
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
  {testId}
  {onchange}
/>
