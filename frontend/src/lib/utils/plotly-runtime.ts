import runtimeUrl from 'plotly.js-dist-min/plotly.min.js?url';
import type Plotly from 'plotly.js-dist-min';

let loading: Promise<typeof Plotly> | undefined;

/** Standalone reports inline the same local asset used by in-app charts. */
export async function loadPlotlySource(): Promise<string> {
  const response = await fetch(runtimeUrl);
  if (!response.ok) throw new Error('The bundled chart library could not load for export.');
  return response.text();
}

/** Keep the prebuilt browser runtime local, without rebuilding its large minified AST. */
export function loadPlotly(): Promise<typeof Plotly> {
  const host = window as typeof window & { Plotly?: typeof Plotly };
  if (host.Plotly) return Promise.resolve(host.Plotly);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = runtimeUrl;
      script.async = true;
      const fail = () => {
        script.remove();
        loading = undefined;
        reject(new Error('The bundled chart library could not load.'));
      };
      script.onerror = fail;
      script.onload = () => host.Plotly ? resolve(host.Plotly) : fail();
      document.head.appendChild(script);
    });
  }
  return loading;
}
