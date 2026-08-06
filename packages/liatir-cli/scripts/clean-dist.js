// Wipes the build output before a rebuild, so files from a previous build (e.g. a module that
// has since been deleted or renamed) cannot linger in dist/ and end up published.
// `force` makes this a no-op on a clean checkout where dist/ does not exist yet.
import * as fs from "fs";
import * as path from "path";

fs.rmSync(path.resolve("dist"), { recursive: true, force: true });
