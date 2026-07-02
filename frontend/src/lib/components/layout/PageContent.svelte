<script lang="ts">

	let { children } = $props();

</script>

<!--
  Fills the space left by PageHeader (sibling in a `flex flex-col h-full` page root)
  and constrains it so an inner `flex-1 overflow-y-auto` child scrolls to the very
  end. Using `h-full` here overflowed past the header and clipped the bottom.
-->
<div class="flex justify-center items-stretch w-full flex-1 min-h-0 overflow-hidden">
    <div class="w-full max-w-9/12 flex flex-col min-h-0">
        {@render children()}
    </div>
</div>
