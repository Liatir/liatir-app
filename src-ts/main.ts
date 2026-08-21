// The barrel of every `buildX` factory, so `bridge.ts` can import them from one place.
//
// Each domain lives in its own folder under a consistent three-file layout:
//   _main.ts     the `buildX(core)` factory that produces the API object
//   _types.ts    its interfaces
//   _helpers.ts  anything internal to it
//
// `modules/rs/*` wrap Rust commands; `modules/qc/*` are the analysis tools. Adding a capability means adding a
// folder and one line here — nothing else in the bridge changes.

export * from "./core/_main";
export * from "./liatir/_main";
export * from "./modules/rs/files/_main";
export * from "./modules/rs/events/_main";
export * from "./modules/rs/fs/_main";
export * from "./modules/rs/clipboard/_main";
export * from "./modules/rs/shortcuts/_main";
export * from "./modules/rs/notifications/_main";
export * from "./modules/rs/app/_main";
export * from "./modules/rs/window/_main";
export * from "./modules/rs/dragdrop/_main";
export * from "./modules/rs/menu/_main";
export * from "./modules/rs/diagnostics/_main";
export * from "./modules/rs/network/_main";
export * from "./modules/rs/autostart/_main";
export * from "./modules/rs/badge/_main";
export * from "./modules/rs/worker/_main";
export * from "./modules/rs/contextMenu/_main";
export * from "./modules/rs/globalVariables/_main";
export * from "./modules/rs/jobs/_main";
export * from "./modules/rs/deps/_main";
export * from "./modules/rs/externalWorkflows/_main";
export * from "./modules/rs/mcp/_main";
export * from "./modules/qc/_main";
export * from "./modules/qc/fastqc/_main";
