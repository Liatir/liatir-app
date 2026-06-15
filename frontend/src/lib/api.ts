/** Typed access to window.Offlab — returns null when unavailable (SSR / web). */
export const offlab = () => {
  if (typeof window === 'undefined') return null;
  return window.Offlab ?? null;
};

export const isDesktop = () =>
  typeof window !== 'undefined' && !!window.Offlab?.isAvailable;
