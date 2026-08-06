/**
 * Descrive tutte le informazioni rilevanti sulla pagina corrente,
 * ispirato allo store `$page` di SvelteKit ma in ambiente JavaScript puro.
 */
export interface PageInfo {
	url: URL;
	protocol: string;               // es: 'https:'
	host: string;                   // es: 'example.com:3000'
	hostname: string;               // es: 'example.com'
	port: string;                   // es: '3000' (vuoto se default)
	origin: string;                 // es: 'https://example.com:3000'
	pathname: string;              // es: '/docs/page'
	fullPath: string;              // pathname + search + hash
	query: Record<string, string>; // search params in oggetto
	search: string;                // es: '?id=123&lang=en'
	hash: string;                  // es: '#section'
	params: Record<string, string>; // dinamici (vuoto se non gestiti)
	referrer: string;              // document.referrer
	userAgent: string;             // navigator.userAgent
	timestamp: number;             // ms
}

type PageStoreCallback = (page: PageInfo) => void;

/**
 * Crea uno store reattivo che fornisce informazioni aggiornate sulla pagina corrente.
 * Si comporta in modo simile allo store `$page` di SvelteKit ma in ambiente JS puro.
 * Reagisce a popstate, hashchange, pushState e replaceState.
 *
 * @returns Un oggetto con due metodi:
 *  - `subscribe(callback)`: riceve aggiornamenti quando cambia l’URL
 *  - `get()`: restituisce lo stato corrente della pagina
 *  - Utilizza come 'const page=pageStore()' e poi 'page.get()' o 'page.subscribe((info)=>{})'
 */
export function pageStore() {
	let listeners: PageStoreCallback[] = [];

	function getPage(): PageInfo {
		const url = new URL(window.location.href);

		return {
			url,
			protocol: url.protocol,
			host: url.host,
			hostname: url.hostname,
			port: url.port,
			origin: url.origin,
			pathname: url.pathname,
			fullPath: url.pathname + url.search + url.hash,
			query: Object.fromEntries(url.searchParams.entries()),
			search: url.search,
			hash: url.hash,
			params: {}, // da riempire se implementi parsing tipo /user/:id
			referrer: document.referrer,
			userAgent: navigator.userAgent,
			timestamp: Date.now()
		};
	}

	function notify() {
		const page = getPage();
		for (const cb of listeners) cb(page);
	}

	window.addEventListener('popstate', notify);
	window.addEventListener('hashchange', notify);

	// intercetta push/replaceState
	for (const method of ['pushState', 'replaceState'] as const) {
		const original = history[method];
		history[method] = function (...args) {
			original.apply(this, args);
			notify();
		};
	}

	return {
		subscribe(callback: PageStoreCallback) {
			listeners.push(callback);
			callback(getPage());
			return () => {
				listeners = listeners.filter((cb) => cb !== callback);
			};
		},
		get: getPage
	};
}
