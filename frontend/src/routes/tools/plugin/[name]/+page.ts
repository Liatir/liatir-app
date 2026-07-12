// Plugins used to live under /tools; they now have their own section. Kept as a redirect so old links keep
// working. Unlike the /modules redirect, the name is dropped — plugins are addressed by id, not by name.
import { redirect } from '@sveltejs/kit';

export const load = () => {
  throw redirect(307, '/plugins');
};
