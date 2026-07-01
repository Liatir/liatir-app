// Close-on-outside-click that works even inside xyflow's transformed canvas,
// where a `fixed inset-0` backdrop is positioned relative to the (panned/zoomed)
// viewport instead of the window and therefore misses part of the screen.
//
// Apply to an element that wraps BOTH the trigger and the dropdown, and bind
// `enabled` to the open state. The listener stays attached but only fires while
// enabled — so the pointerdown that opens the dropdown (fired while still
// disabled) can never immediately close it.
export interface ClickOutsideParams {
  enabled: boolean;
  onOutside: () => void;
}

export function clickOutside(node: HTMLElement, params: ClickOutsideParams) {
  let { enabled, onOutside } = params;

  function handlePointerDown(event: PointerEvent) {
    if (enabled && !node.contains(event.target as Node)) onOutside();
  }

  document.addEventListener('pointerdown', handlePointerDown, true);

  return {
    update(next: ClickOutsideParams) {
      enabled = next.enabled;
      onOutside = next.onOutside;
    },
    destroy() {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    },
  };
}
