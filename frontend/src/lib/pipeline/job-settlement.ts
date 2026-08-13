import type { JsonValue } from '@liatir/core';
import { RunCancelledError } from './cancellation';

export type SettledJobStatus =
	| { type: 'running' }
	| { type: 'done'; exitCode?: number | null }
	| { type: 'failed'; exitCode?: number | null }
	| { type: 'killed' };

export interface SettledJobEntry {
	status: SettledJobStatus;
	metadata?: Record<string, JsonValue> | null;
}

export interface BufferedJobOutput {
	stdout: string[];
	stderr: string[];
	stdoutTotal: number;
	stderrTotal: number;
}

export interface JobSettlementBridge {
	invoke(command: string, payload: Record<string, unknown>): Promise<unknown>;
}

export interface JobSettlementOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
	pollIntervalMs?: number;
	onStdout?: (line: string) => void;
	onStderr?: (line: string) => void;
}

export interface JobSettlement {
	entry: SettledJobEntry;
	stdout: string[];
	stderr: string[];
	timedOut: boolean;
}

/**
 * Wait for one spawned Job to become terminal and drain its final buffered output.
 *
 * Spawn acknowledgement is deliberately not settlement. The extra output read after a terminal
 * status closes the race where status and output are queried concurrently and the last line lands
 * between those two reads (notably a Plugin's structured result marker).
 */
export async function waitForJobSettlement(
	bridge: JobSettlementBridge,
	jobId: string,
	options: JobSettlementOptions = {}
): Promise<JobSettlement> {
	const stdout: string[] = [];
	const stderr: string[] = [];
	let stdoutSeen = 0;
	let stderrSeen = 0;
	const startedAt = Date.now();
	const pollIntervalMs = options.pollIntervalMs ?? 100;

	let killPromise: Promise<void> | null = null;
	const kill = () => {
		killPromise ??= bridge.invoke('lia_jobs_kill', { jobId }).then(
			() => undefined,
			() => undefined
		);
		return killPromise;
	};
	const abort = () => {
		void kill();
	};
	options.signal?.addEventListener('abort', abort, { once: true });

	const drain = async () => {
		const output = (await bridge.invoke('lia_jobs_get_output', { jobId })) as BufferedJobOutput;
		for (const line of output.stdout.slice(stdoutSeen)) {
			stdout.push(line);
			options.onStdout?.(line);
		}
		for (const line of output.stderr.slice(stderrSeen)) {
			stderr.push(line);
			options.onStderr?.(line);
		}
		stdoutSeen = output.stdoutTotal;
		stderrSeen = output.stderrTotal;
	};

	try {
		while (true) {
			if (options.signal?.aborted) {
				await kill();
				throw new RunCancelledError();
			}

			const [entry] = await Promise.all([
				bridge.invoke('lia_jobs_status', { jobId }) as Promise<SettledJobEntry>,
				drain()
			]);

			if (entry.status.type !== 'running') {
				if (options.signal?.aborted) {
					await kill();
					throw new RunCancelledError();
				}
				await drain();
				return { entry, stdout, stderr, timedOut: false };
			}

			if (options.timeoutMs !== undefined && Date.now() - startedAt > options.timeoutMs) {
				await kill();
				const terminalEntry = (await bridge.invoke('lia_jobs_status', { jobId })) as SettledJobEntry;
				await drain();
				return { entry: terminalEntry, stdout, stderr, timedOut: true };
			}

			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
	} finally {
		options.signal?.removeEventListener('abort', abort);
	}
}
