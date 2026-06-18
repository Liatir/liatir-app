import { writable, type Writable } from "svelte/store";


export const codeIfEmpty: string = `// Liatir API is available as 'Liatir'
// Use 'return' to output a value, or just let statements run.
// ⌘↵ to execute
//
//
// ------- Example: get jobs list ------- 
//
// const jobs = await Liatir.jobs.list();
// return jobs;
//
//
// ------- Example: get app info ------- 
//
// const appInfo = await Liatir.desktop.app.info()
// return appInfo;
`;


export const latestCodeEdit: Writable<string> = writable(codeIfEmpty);
