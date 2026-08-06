<script lang="ts">
  import Select from '$lib/components/ui/Select.svelte';
  import KeyValueTable from '$lib/components/ui/KeyValueTable.svelte';
  import type { ApiAuth, AuthType, ApiKeyValue, HttpMethod } from '$lib/types/api-connection';

  interface Props {
    auth: ApiAuth;
    allowInherit?: boolean;   // call-level auth can inherit from the provider
    disabled?: boolean;
    onchange: (auth: ApiAuth) => void;
  }

  let { auth, allowInherit = false, disabled = false, onchange }: Props = $props();

  const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  // Faithful to Bubble.io's authentication list.
  const options = $derived([
    ...(allowInherit ? [{ value: 'inherit', label: 'Inherit from API' }] : []),
    { value: 'none', label: 'None or self-handled' },
    { value: 'basic', label: 'HTTP Basic Auth' },
    { value: 'private-key-header', label: 'Private key in header' },
    { value: 'private-key-url', label: 'Private key in URL' },
    { value: 'oauth2-password', label: 'OAuth2 Password Flow' },
    { value: 'oauth2-custom', label: 'OAuth2 Custom Token' },
    { value: 'jwt', label: 'JSON Web Token' },
    { value: 'oauth2-user-agent', label: 'OAuth2 User-Agent Flow (coming soon)' },
  ]);

  function set(patch: Partial<ApiAuth>) { onchange({ ...auth, ...patch }); }
  function setType(t: string) {
    if (t === 'oauth2-user-agent') return; // phase 2, disabled
    set({ type: t as AuthType });
  }

  function ctr() {
    return auth.customTokenRequest ?? { method: 'POST' as HttpMethod, url: '', headers: [], body: { type: 'json' as const, content: '' } };
  }
  function setCtr(patch: Partial<NonNullable<ApiAuth['customTokenRequest']>>) {
    set({ customTokenRequest: { ...ctr(), ...patch } });
  }

  const fieldCls = 'w-full text-xs border border-border rounded px-2 py-1 bg-surface outline-none focus:border-brand/60 font-mono';
</script>

<div class="space-y-2.5">
  <div class="flex items-center gap-2">
    <span class="text-[11px] font-medium text-text-muted w-28 shrink-0">Authentication</span>
    <Select value={auth.type} options={options} onchange={setType} class="flex-1 max-w-72" />
  </div>

  {#if auth.type === 'basic'}
    <div class="grid grid-cols-2 gap-2 pl-30">
      <input type="text" value={auth.username ?? ''} placeholder="Username" {disabled}
        oninput={(e) => set({ username: (e.target as HTMLInputElement).value })} class={fieldCls} />
      <input type="password" value={auth.password ?? ''} placeholder="Password" {disabled}
        oninput={(e) => set({ password: (e.target as HTMLInputElement).value })} class={fieldCls} />
    </div>

  {:else if auth.type === 'private-key-header' || auth.type === 'private-key-url'}
    <div class="grid grid-cols-2 gap-2 pl-30">
      <input type="text" value={auth.keyName ?? ''} {disabled}
        placeholder={auth.type === 'private-key-header' ? 'Header name (e.g. Authorization)' : 'Query param name (e.g. api_key)'}
        oninput={(e) => set({ keyName: (e.target as HTMLInputElement).value })} class={fieldCls} />
      <input type="text" value={auth.keyValue ?? ''} placeholder="Key value" {disabled}
        oninput={(e) => set({ keyValue: (e.target as HTMLInputElement).value })} class={fieldCls} />
    </div>

  {:else if auth.type === 'oauth2-password'}
    <div class="grid grid-cols-2 gap-2 pl-30">
      <input type="text" value={auth.tokenUrl ?? ''} placeholder="Token endpoint URL" {disabled}
        oninput={(e) => set({ tokenUrl: (e.target as HTMLInputElement).value })} class="{fieldCls} col-span-2" />
      <input type="text" value={auth.clientId ?? ''} placeholder="Client ID" {disabled}
        oninput={(e) => set({ clientId: (e.target as HTMLInputElement).value })} class={fieldCls} />
      <input type="password" value={auth.clientSecret ?? ''} placeholder="Client secret" {disabled}
        oninput={(e) => set({ clientSecret: (e.target as HTMLInputElement).value })} class={fieldCls} />
      <input type="text" value={auth.username ?? ''} placeholder="Username" {disabled}
        oninput={(e) => set({ username: (e.target as HTMLInputElement).value })} class={fieldCls} />
      <input type="password" value={auth.password ?? ''} placeholder="Password" {disabled}
        oninput={(e) => set({ password: (e.target as HTMLInputElement).value })} class={fieldCls} />
      <input type="text" value={auth.scope ?? ''} placeholder="Scope (optional)" {disabled}
        oninput={(e) => set({ scope: (e.target as HTMLInputElement).value })} class={fieldCls} />
      <input type="text" value={auth.tokenPath ?? ''} placeholder="Token path (default: access_token)" {disabled}
        oninput={(e) => set({ tokenPath: (e.target as HTMLInputElement).value })} class={fieldCls} />
    </div>

  {:else if auth.type === 'oauth2-custom'}
    <div class="pl-30 space-y-2">
      <div class="flex items-center gap-2">
        <Select value={ctr().method} options={METHODS.map(m => ({ value: m, label: m }))} onchange={(m) => setCtr({ method: m as HttpMethod })} class="w-24" />
        <input type="text" value={ctr().url} placeholder="Token request URL" {disabled}
          oninput={(e) => setCtr({ url: (e.target as HTMLInputElement).value })} class="{fieldCls} flex-1" />
      </div>
      <div>
        <span class="text-[10px] text-text-subtle">Token request headers</span>
        <KeyValueTable rows={ctr().headers} {disabled} onchange={(headers: ApiKeyValue[]) => setCtr({ headers })} />
      </div>
      <textarea value={ctr().body.content} placeholder={'Token request body (JSON)\n{ "grant_type": "client_credentials" }'} {disabled}
        oninput={(e) => setCtr({ body: { type: 'json', content: (e.target as HTMLTextAreaElement).value } })}
        rows={3} class="{fieldCls} resize-y"></textarea>
      <input type="text" value={auth.tokenPath ?? ''} placeholder="Token path (default: access_token)" {disabled}
        oninput={(e) => set({ tokenPath: (e.target as HTMLInputElement).value })} class={fieldCls} />
    </div>

  {:else if auth.type === 'jwt'}
    <div class="pl-30 space-y-2">
      <div class="flex items-center gap-2">
        <Select value={auth.jwtAlg ?? 'HS256'} options={['HS256', 'HS384', 'HS512'].map(a => ({ value: a, label: a }))}
          onchange={(a) => set({ jwtAlg: a as ApiAuth['jwtAlg'] })} class="w-28" />
        <input type="password" value={auth.jwtSecret ?? ''} placeholder="Signing secret" {disabled}
          oninput={(e) => set({ jwtSecret: (e.target as HTMLInputElement).value })} class="{fieldCls} flex-1" />
      </div>
      <textarea value={auth.jwtPayload ?? ''} placeholder={'Payload (JSON)\n{ "iss": "my-app", "exp": 0 }'} {disabled}
        oninput={(e) => set({ jwtPayload: (e.target as HTMLTextAreaElement).value })}
        rows={3} class="{fieldCls} resize-y"></textarea>
    </div>

  {:else if auth.type === 'oauth2-user-agent'}
    <p class="pl-30 text-[11px] text-amber-600">OAuth2 User-Agent (browser redirect) flow is coming in a later update.</p>
  {/if}
</div>
