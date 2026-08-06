/**
 * `Liatir.jobs` — spawning and tracking long-running processes.
 *
 * A job is how anything slow gets run: a native tool, a Python script, a plugin. It is *detached* — `spawn`
 * returns as soon as the process starts, and its output and status arrive later, which is what lets an
 * analysis run for minutes while the user keeps working.
 *
 * `label`, `kind` and `metadata` are what make a job identifiable after the fact. The Jobs list uses them to
 * show what a process is, and `metadata` is where the caller stashes whatever it will need to turn the
 * finished job into a Result (see `direct-run-context` on the frontend side).
 */
import { LiatirAPI } from "../../../types";
import { JobsInterface } from "./_types";
export declare function buildJobs(core: {
    invoke: LiatirAPI["invoke"];
}): JobsInterface;
