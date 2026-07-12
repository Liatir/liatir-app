// Restated here (already off app-wide in the root +layout.ts) because this section is entered with no active
// workspace, and must never be statically rendered: its content is the list of workspaces on *this* machine.
export const ssr = false;
export const prerender = false;
