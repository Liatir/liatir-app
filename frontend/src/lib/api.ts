/** Typed access to window.Liatir — returns null when unavailable (SSR / web). */
export const liatir = () => {
  if (typeof window === 'undefined') return null;
  return window.Liatir ?? null;
};

export const isDesktop = () =>
  typeof window !== 'undefined' && !!window.Liatir?.isAvailable;
