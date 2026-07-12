<!--
	A horizontal rule. `my` sets the vertical margin in pixels; the rest spreads through, so a caller can
	still pass a class or an id.
-->
<script lang="ts">

  let { my=0, ...rest } = $props();


</script>

<div class="border-t border-border w-full h-[1px]" style="margin-top: {my??0}px; margin-bottom: {my??0}px;" {...rest}></div>