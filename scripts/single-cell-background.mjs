/** Keep a study driver and its durable exit evidence independent of the launching session. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function writeRecord(file, value) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

export function launchBackground({ directory, args, cwd, environment = {} }) {
  fs.mkdirSync(directory, { recursive: true });
  const id = randomUUID();
  const execution = path.join(directory, id);
  fs.mkdirSync(execution);
  const request = { id, command: process.execPath, args, cwd, environment, startedAt: new Date().toISOString() };
  const requestFile = path.join(execution, 'request.json');
  writeRecord(requestFile, request);
  const log = fs.openSync(path.join(execution, 'driver.log'), 'a');
  const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', requestFile], {
    cwd, detached: true, stdio: ['ignore', log, log], env: process.env,
    windowsHide: true,
  });
  fs.closeSync(log);
  worker.unref();
  writeRecord(path.join(execution, 'launcher.json'), { id, pid: worker.pid, requestFile });
  return { id, pid: worker.pid, execution };
}

if (process.argv[2] === '--worker') {
  const requestFile = path.resolve(process.argv[3]);
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
  const execution = path.dirname(requestFile);
  const child = spawn(request.command, request.args, {
    cwd: request.cwd, stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ...request.environment }, windowsHide: true,
  });
  writeRecord(path.join(execution, 'running.json'), { id: request.id, driverPid: child.pid, supervisorPid: process.pid });
  const finish = (code, signal, error = null) => {
    writeRecord(path.join(execution, 'exit.json'), {
      id: request.id, code, signal, error, endedAt: new Date().toISOString(),
      status: code === 0 && !signal && !error ? 'completed' : 'failed',
    });
    process.exitCode = code === 0 && !signal && !error ? 0 : 1;
  };
  child.once('error', (error) => finish(null, null, String(error)));
  child.once('exit', (code, signal) => finish(code, signal));
}
