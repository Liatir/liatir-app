type LiatirWindowObject = NonNullable<Window['Liatir']>;

export const getLiatirWindowObject = (): LiatirWindowObject | null => {
  if (typeof window === 'undefined') return null;
  return window.Liatir ?? null;
};

/** Typed access to window.Liatir — returns null when unavailable (SSR / web). */
export const liatir = getLiatirWindowObject;

export const isDesktop = () =>
  !!getLiatirWindowObject()?.isAvailable;
