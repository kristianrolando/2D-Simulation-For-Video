// Keep the Mac awake while the studio has work (a render queue or an upload): `caffeinate -i -w <server pid>` prevents idle sleep and
// ends by itself when the server does. Nothing happens off macOS, and a missing caffeinate is not an error.
import { spawn as realSpawn, type ChildProcess } from 'node:child_process';

export function createAwake(o: { spawn?: typeof realSpawn; pid?: number; platform?: string } = {}) {
  const run = o.spawn ?? realSpawn, pid = o.pid ?? process.pid, platform = o.platform ?? process.platform;
  let child: ChildProcess | null = null;
  return {
    set(on: boolean) {
      if (platform !== 'darwin') return;
      if (on && !child) {
        try { const c = run('caffeinate', ['-i', '-w', String(pid)], { stdio: 'ignore' }); child = c; c.on('exit', () => { if (child === c) child = null; }); c.on('error', () => { if (child === c) child = null; }); } catch { child = null; }
      } else if (!on && child) { const c = child; child = null; try { c.kill(); } catch { /* gone */ } }
    },
    active: () => child !== null,
  };
}
