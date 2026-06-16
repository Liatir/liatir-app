import { writable, type Writable } from "svelte/store";

export const latestCodeEdit: Writable<string> = writable(`// Offlab API is available as 'Offlab'
// Use 'return' to output a value, or just let statements run.
// ⌘↵ to execute

const jobs = await Offlab.jobs.list();
return jobs;`);