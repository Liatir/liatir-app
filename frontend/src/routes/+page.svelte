<script lang="ts">
	import { goto } from "$app/navigation";
	import { COMPANION_URL_GLOBAL_VAR_KEY } from "$lib";
	import { Desktopr } from "desktopr";
	import { validate } from "./_typesValidation";
	import { onMount } from "svelte";

	const year = new Date().getFullYear();

    const normalizeUrl = (urlString: string) => {
        const parts = urlString.trim().split('?');
        const base = parts[0];
        const baseUrl = base.trim().replaceAll("https://","").replaceAll("http://","");
        let _url = baseUrl;
        if(validate.nonEmptyString(parts[1])) _url = (`${_url.trim()}?${(parts[1]).trim()}`).trim();
        return `https://${_url}`;
    }

    let loading: boolean = $state(false);
    let url: string = $state("");
    let fullUrl: string = $derived(normalizeUrl(url));

    $effect(()=>{
        if(url && fullUrl && url!=fullUrl) url=fullUrl;
    })

    const launchCompanion = async () => {
        loading=true;
        try {
            const _url = fullUrl.trim();
            const validUrl = validate.url(_url);
            if(!validUrl) return alert("Invalid URL");
            await Desktopr.globalVariables.set(COMPANION_URL_GLOBAL_VAR_KEY,_url);
            location.href = _url;
        } catch (error) {
            console.log(error);
            alert("Something went wrong");
        } finally {
            loading=false;
        }
    }

    const openDtrApp = () => {
        Desktopr.tauri.shell.open("https://dashboard.desktopr.app");
    }

    onMount(async ()=>{
        loading=true; 
        try {
            const savedUrl = await Desktopr.globalVariables.get(COMPANION_URL_GLOBAL_VAR_KEY);
            if(validate.url(savedUrl)) url=savedUrl;
        } catch (error) {
            console.log(error);
        } finally {
            loading=false;
        }
    })
</script>

<header
	class="h-20 px-8 flex items-center justify-between border-b border-neutral-800 text-lg font-semibold bg-neutral-800/10"
>
    <div class="flex items-center justify-start">
	<span class="relative mr-4 inline-flex h-[30px] w-[30px] items-center justify-center">
		<img src="/icons/dtr-icon.png" />
	</span>
	<span class="flex flex-col items-start justify-center space-y-0 gap-0 -mb-1">
		<span class="text-xs text-amber-500 w-full -mb-0.5 font-light text-left">Desktopr</span>
		<span class="-mt-0.5">Companion</span>
	</span>
    </div>
    <div>
            <button onclick={openDtrApp} class="px-4 py-2 text-xs bg-neutral-800 hover:cursor-pointer hover:bg-amber-500 hover:text-neutral-800 text-neutral-400 font-medium rounded-md">
                Bubledesk App
            </button>
        </div>
</header>

<main class="flex-1 flex items-center justify-center px-4 bg-neutral-800/10">
    {#if loading}
        <div class="flex items-center justify-center h-full w-full">
            <div class="h-8 w-8 animate-spin rounded-full border-2 border-slate-500 border-t-amber-500"></div>
        </div>
    {:else}
        <form class="w-full max-w-md flex flex-col overflow-hidden" onsubmit={launchCompanion}>
            <!-- <label for="url" class="text-neutral-300/80 text-center mb-2">
                Enter your app url to launch companion:
            </label> -->
            <input
                bind:value={url}
                id="url"
                type="url"
                required
                placeholder="Enter your app URL (eg. https://your-app.com)"
                class="w-full rounded-t-xl text-center border placeholder:text-neutral-500 border-neutral-700 border-b-neutral-800 bg-neutral-900 px-4 py-4 text-sm text-neutral-100
                transition focus:border-amber-500 ring-none outline-none overflow-hidden"
            />
            <button type="submit" class="px-4 py-2 border {url?.trim()?"bg-amber-500 border-amber-500 hover:cursor-pointer hover:bg-amber-500/90 text-neutral-800":" bg-neutral-800 border-neutral-800 text-neutral-600"} border-t-0 text-sm font-medium rounded-b-xl">
                Launch Companion
            </button>
        </form>
    {/if}
</main>

<footer
	class="h-14 border-t border-neutral-800 flex items-center justify-center text-xs text-neutral-400"
>
	© {year} Desktopr
</footer>
