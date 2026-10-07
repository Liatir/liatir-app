<!--
	One line-art icon, by name.

	Both home pages drew the same set inline, twice each, so adding an icon meant editing four
	template chains and forgetting one. The names are the `icon` values in `home-content.ts`.
-->
<script setup lang="ts">
defineProps<{ name: string }>()
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name === 'shield'">
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </template>
    <template v-else-if="name === 'box'">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </template>
    <template v-else-if="name === 'link'">
      <path d="M10.5 13.5a4 4 0 005.7 0l2.3-2.3a4 4 0 00-5.7-5.7l-1.2 1.2" />
      <path d="M13.5 10.5a4 4 0 00-5.7 0l-2.3 2.3a4 4 0 005.7 5.7l1.2-1.2" />
    </template>
    <template v-else-if="name === 'terminal'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </template>
    <template v-else-if="name === 'spark'">
      <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9l4.7-1.3z" />
      <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
    </template>
    <template v-else-if="name === 'workflow'">
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M8 5h3a3 3 0 013 3v1M8 19h3a3 3 0 003-3v-1" />
    </template>
    <template v-else-if="name === 'flow'">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8 7.5l3 8M16 7.5l-3 8" />
    </template>
    <template v-else-if="name === 'plug'">
      <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0z" />
      <path d="M12 17v4" />
    </template>
    <template v-else-if="name === 'puzzle'">
      <path d="M9 5V3.5a2.5 2.5 0 015 0V5h4a1 1 0 011 1v4h1.5a2.5 2.5 0 010 5H19v4a1 1 0 01-1 1h-4v-1.5a2.5 2.5 0 00-5 0V20H5a1 1 0 01-1-1v-4h1.5a2.5 2.5 0 000-5H4V6a1 1 0 011-1z" />
    </template>
    <template v-else-if="name === 'layers'">
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </template>
    <template v-else-if="name === 'eye'">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="2.5" />
    </template>
    <template v-else-if="name === 'chat'">
      <path d="M20 11.5a7.5 7.5 0 01-7.5 7.5H8l-4 3v-4.6A7.5 7.5 0 018 4h4.5a7.5 7.5 0 017.5 7.5z" />
      <path d="M9 11h6" />
    </template>
    <template v-else-if="name === 'bolt'">
      <path d="M13 2L4 14h6l-1 8 9-12h-6z" />
    </template>
  </svg>
</template>
