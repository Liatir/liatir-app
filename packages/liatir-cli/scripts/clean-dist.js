import * as fs from "fs";
import * as path from "path";

fs.rmSync(path.resolve("dist"), { recursive: true, force: true });
