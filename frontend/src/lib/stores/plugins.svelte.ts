import { liatir } from '$lib/api';

function createPluginsStore() {
  let plugins = $state<string[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  return {
    get plugins() { return plugins; },
    get loading() { return loading; },
    get error() { return error; },

    async refresh() {
      const api = liatir();
      if (!api) return;
      loading = true;
      error = null;
      try {
        plugins = await api.plugins.list();
      } catch (e) {
        error = String(e);
      } finally {
        loading = false;
      }
    },

    async add(): Promise<{ name: string } | null> {
      const api = liatir();
      if (!api) return null;
      error = null;
      try {
        const result = await api.plugins.add('');
        await this.refresh();
        return result as { name: string };
      } catch (e) {
        error = String(e);
        return null;
      }
    },

    async remove(name: string) {
      const api = liatir();
      if (!api) return;
      error = null;
      try {
        await api.plugins.remove(name);
        plugins = plugins.filter((m) => m !== name);
      } catch (e) {
        error = String(e);
      }
    },
  };
}

export const pluginsStore = createPluginsStore();
