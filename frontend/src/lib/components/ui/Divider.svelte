<script lang="ts">

  let { my=0, ...rest } = $props();


</script>

<div class="border-t border-border w-full h-[1px]" style="margin-top: {my??0}px; margin-bottom: {my??0}px;" {...rest}></div>