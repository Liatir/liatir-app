// Legacy redirect for the old "modules" naming, preserving the id so a deep link to a specific plugin still
// lands on that plugin rather than on the list. See `modules/+page.ts`.
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
  throw redirect(307, `/plugins/${params.id}`);
};
