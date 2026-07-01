
<script lang="ts">

	let { children } = $props();

</script>

<div class="flex justify-center items-stretch w-full h-full">
    <div class="w-full max-w-12/12 flex flex-col justify-start">
			{@render children()}
    </div>
</div>