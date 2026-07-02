type DerivedStub = (<T>(value: T | (() => T)) => T) & { by: <T>(fn: () => T) => T };

export function installSvelteRuneStubs() {
  const state = <T>(value: T): T => value;
  const derived = ((value) => (typeof value === 'function' ? (value as () => unknown)() : value)) as DerivedStub;
  derived.by = (fn) => fn();

  Object.assign(globalThis, {
    $state: state,
    $derived: derived,
    $effect: () => undefined,
  });
}
