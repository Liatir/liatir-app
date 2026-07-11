import { liatir } from '$lib/api';
import { standaloneQuentaUrl } from './navigation';

const QUENTA_WINDOW_SCALE = 0.92;
const QUENTA_WINDOW_MIN_WIDTH = 840;
const QUENTA_WINDOW_MIN_HEIGHT = 560;
const QUENTA_WINDOW_MAX_WIDTH = 1280;
const QUENTA_WINDOW_MAX_HEIGHT = 900;
const QUENTA_WINDOW_MARGIN = 32;
const QUENTA_WINDOW_FALLBACK = { width: 1100, height: 720 };

// Keeps a new Quenta window smaller than its main-window parent while avoiding
// impractically small defaults and oversized windows on large displays.
function scaledQuentaDimension(source: number, minimum: number, maximum: number): number {
  const smallerThanMain = Math.max(1, Math.floor(source) - QUENTA_WINDOW_MARGIN);
  const preferred = Math.floor(source * QUENTA_WINDOW_SCALE);
  const adaptiveMinimum = Math.min(minimum, smallerThanMain);
  return Math.min(maximum, smallerThanMain, Math.max(adaptiveMinimum, preferred));
}

async function quentaWindowSize(api: NonNullable<ReturnType<typeof liatir>>) {
  try {
    const main = await api.desktop.window.getInfo('main');
    const width = main.inner_size?.width;
    const height = main.inner_size?.height;
    const scaleFactor = typeof main.scale_factor === 'number'
      && Number.isFinite(main.scale_factor)
      && main.scale_factor > 0
      ? main.scale_factor
      : 1;
    if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
      return QUENTA_WINDOW_FALLBACK;
    }
    const logicalWidth = width / scaleFactor;
    const logicalHeight = height / scaleFactor;
    return {
      width: scaledQuentaDimension(logicalWidth, QUENTA_WINDOW_MIN_WIDTH, QUENTA_WINDOW_MAX_WIDTH),
      height: scaledQuentaDimension(logicalHeight, QUENTA_WINDOW_MIN_HEIGHT, QUENTA_WINDOW_MAX_HEIGHT),
    };
  } catch {
    return QUENTA_WINDOW_FALLBACK;
  }
}

export async function openQuentaWindow(route: string): Promise<void> {
  const api = liatir();
  if (!api) throw new Error('The Liatir window bridge is unavailable');
  const size = await quentaWindowSize(api);
  await api.desktop.window.new({
    url: standaloneQuentaUrl(route),
    ...size,
  });
}
