// "Modules" was the old name for what are now Plugins. The route is kept as a redirect so existing links,
// bookmarks and saved deep links do not break. 307 (temporary) rather than 301: a permanent redirect would
// be cached by the webview and could not be undone if the route is ever reused.
import { redirect } from '@sveltejs/kit';

export const load = () => {
  throw redirect(307, '/plugins');
};
