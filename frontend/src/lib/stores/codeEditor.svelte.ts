import { writable, type Writable } from "svelte/store";


export const codeIfEmpty: string = `// Offlab API is available as 'Offlab'
// Use 'return' to output a value, or just let statements run.
// ⌘↵ to execute
//
//
// ------- Example: get jobs list ------- 
//
// const jobs = await Offlab.jobs.list();
// return jobs;
//
//
// ------- Example: get app info ------- 
//
// const appInfo = await Offlab.desktop.app.info()
// return appInfo;
`;


export const latestCodeEdit: Writable<string> = writable(codeIfEmpty);
