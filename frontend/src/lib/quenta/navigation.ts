import type { LiatirQuentaFocus, LiatirQuentaIntent } from '@liatir/core';

export interface QuentaLaunchRequest {
  intent: LiatirQuentaIntent;
  focus: LiatirQuentaFocus;
  autoSend: boolean;
}

const ONE_SHOT_QUENTA_PARAMS = ['intent', 'mode', 'run', 'job', 'auto'] as const;

function intentFromParam(value: string | null): LiatirQuentaIntent {
  if (value === 'explain-result' || value === 'explain-failure' || value === 'report') return value;
  return 'chat';
}

export function quentaLaunchRequest(url: URL): QuentaLaunchRequest | null {
  const runId = url.searchParams.get('run');
  const jobId = url.searchParams.get('job');
  const focus = runId
    ? { kind: 'result' as const, entityId: runId }
    : jobId
      ? { kind: 'job' as const, entityId: jobId }
      : null;
  if (!focus) return null;
  return {
    intent: intentFromParam(url.searchParams.get('intent') ?? url.searchParams.get('mode')),
    focus,
    autoSend: url.searchParams.get('auto') === '1',
  };
}

export function consumedQuentaUrl(url: URL): string {
  const consumed = new URL(url);
  for (const parameter of ONE_SHOT_QUENTA_PARAMS) consumed.searchParams.delete(parameter);
  return `${consumed.pathname}${consumed.search}${consumed.hash}`;
}

export function standaloneQuentaUrl(route: string): string {
  const url = new URL(route, 'tauri://localhost');
  if (url.pathname !== '/quenta') throw new Error('Quenta windows must open the Quenta route');
  url.searchParams.set('window', '1');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function quentaDraftUrl(
  intent: LiatirQuentaIntent,
  focus: LiatirQuentaFocus,
  options: { standalone?: boolean } = {},
): string {
  const params = new URLSearchParams({ intent });
  params.set(focus.kind === 'result' ? 'run' : 'job', focus.entityId);
  if (options.standalone) params.set('window', '1');
  return `/quenta?${params.toString()}`;
}
