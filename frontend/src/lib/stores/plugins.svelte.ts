import { offlab } from '$lib/api';

function createPluginsStore() {
  let modules = $state<string[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  return {
    get modules() { return modules; },
    get loading() { return loading; },
    get error() { return error; },

    async refresh() {
      const api = offlab();
      if (!api) return;
      loading = true;
      error = null;
      try {
        modules = await api.plugins.list();
      } catch (e) {
        error = String(e);
      } finally {
        loading = false;
      }
    },

    async add(): Promise<{ name: string } | null> {
      const api = offlab();
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
      const api = offlab();
      if (!api) return;
      error = null;
      try {
        await api.plugins.remove(name);
        modules = modules.filter((m) => m !== name);
      } catch (e) {
        error = String(e);
      }
    },
  };
}

export const pluginsStore = createPluginsStore();
