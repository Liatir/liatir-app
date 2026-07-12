/**
 * Lets the unit tests import Svelte stores without a Svelte compiler.
 *
 * The stores are `.svelte.ts` files: they use the runes (`$state`, `$derived`, `$effect`), which normally only
 * exist because the Svelte compiler rewrites them. The unit suite runs in plain Node, so those calls would
 * simply be undefined — and the store could not be imported at all.
 *
 * These stubs make the runes *inert but valid*: `$state` returns its value unchanged, `$derived` evaluates once
 * and does not track anything, `$effect` does nothing. The result is that a store's **logic** can be tested in
 * isolation — its reducers, its guards, its derived shapes — while its reactivity, which belongs to Svelte and
 * not to us, is simply out of scope.
 *
 * The consequence is worth knowing: a test using these cannot observe a value *changing* in response to
 * another. Anything that depends on reactivity has to be covered by the end-to-end suite instead.
 */
type DerivedStub = (<T>(value: T | (() => T)) => T) & { by: <T>(fn: () => T) => T };

export function installSvelteRuneStubs() {
  const state = <T>(value: T): T => value;
  // Accepts both `$derived(expr)` and `$derived(() => expr)`, evaluating the function form immediately.
  const derived = ((value) => (typeof value === 'function' ? (value as () => unknown)() : value)) as DerivedStub;
  derived.by = (fn) => fn();

  Object.assign(globalThis, {
    $state: state,
    $derived: derived,
    $effect: () => undefined,
  });
}
