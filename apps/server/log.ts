// The server's log lines get a time stamp, pass through the secret redactor, and the log file is kept from growing forever.
// The launchers append stdout to ~/Library/Logs/Sim Studio.log (`nohup node … >> log`), so the file is shared with the shell; rotation
// copies it to <file>.1 and truncates it through the server's own stdout descriptor (never when stdout is not that file).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { format } from 'node:util';

export const defaultLogFile = () => process.env.SIM_LOG_FILE ? path.resolve(process.env.SIM_LOG_FILE) : path.join(os.homedir(), 'Library', 'Logs', 'Sim Studio.log');
export const LOG_MAX_BYTES = 5 * 1024 * 1024;

export const logLine = (args: unknown[], redact: (s: string) => string, now = new Date()) => `${now.toISOString()} ${redact(format(...args))}\n`;

/** keep one old copy (<file>.1) and start the file again; true when it rotated. Only touches `file` when `fd` really is that file. */
export function rotateLog(file: string, fd: number, maxBytes = LOG_MAX_BYTES): boolean {
  try {
    const st = fs.statSync(file); if (st.size <= maxBytes) return false;
    const f = fs.fstatSync(fd); if (!f.isFile() || f.ino !== st.ino || f.dev !== st.dev) return false;
    fs.copyFileSync(file, file + '.1'); fs.ftruncateSync(fd, 0); return true;
  } catch { return false; }
}

export function installLog(o: { redact: (s: string) => string; file?: string; maxBytes?: number }) {
  const out = (stream: NodeJS.WriteStream) => (...args: unknown[]) => { stream.write(logLine(args, o.redact)); };
  console.log = console.info = console.debug = out(process.stdout); console.warn = console.error = out(process.stderr);
  const rotate = () => rotateLog(o.file ?? defaultLogFile(), 1, o.maxBytes);
  rotate();
  return { rotate };
}
