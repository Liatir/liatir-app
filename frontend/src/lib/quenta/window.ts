import { liatir } from '$lib/api';
import { standaloneQuentaUrl } from './navigation';

export async function openQuentaWindow(route: string): Promise<void> {
  const api = liatir();
  if (!api) throw new Error('The Liatir window bridge is unavailable');
  await api.desktop.window.new({
    url: standaloneQuentaUrl(route),
  });
}
