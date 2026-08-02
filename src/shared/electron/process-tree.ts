import { execFile } from 'node:child_process';

/**
 * Process-tree lifecycle helpers: the one place that knows how to end a child process AND its
 * descendants. A bare `child.kill()` signals only the direct child — a language server's MSBuild
 * workers, a shell's running build, a debug adapter's debuggee all survive it, which is how
 * force-killed or closed sessions kept stalling the machine afterwards. Long-lived children are
 * spawned as their own process-group leaders (see {@link detachedSpawnOptions}) so the whole tree can
 * be signalled by the negated group id, with a SIGKILL escalation for anything that ignores the
 * polite request. On Windows there are no process groups or signals; `taskkill /T /F` walks and
 * forcibly ends the tree instead.
 */

/**
 * How long, in milliseconds, a process tree is given to exit after SIGTERM before it is SIGKILLed,
 * when the caller does not choose its own grace period.
 */
export const DEFAULT_KILL_GRACE_MS: number = 3_000;

/**
 * The spawn options that make a child its own process-group leader, so the whole tree it spawns can
 * be signalled at once. Windows has no process groups (and `detached` would allocate a console
 * instead); tree kills there go through `taskkill /T`.
 * @returns Returns the options to spread into a `spawn` call.
 */
export function detachedSpawnOptions(): { detached: boolean } {
  return { detached: process.platform !== 'win32' };
}

/**
 * Signals a process group by its leader's pid, falling back to the single process when the group
 * signal fails (the leader may not have been detached, or the group is already gone). On Windows any
 * signal becomes a forced `taskkill /T` of the tree.
 * @param pid The group leader's process identifier.
 * @param signal The signal to deliver.
 * @param kill The signal primitive, injectable for testing.
 */
export function signalProcessTree(
  pid: number,
  signal: NodeJS.Signals,
  kill: (pid: number, signal: NodeJS.Signals) => unknown = (
    target: number,
    name: NodeJS.Signals,
  ): boolean => process.kill(target, name),
): void {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], (): void => undefined);
    return;
  }
  try {
    kill(-pid, signal);
  } catch {
    try {
      kill(pid, signal);
    } catch {
      // The process is already gone; nothing to signal.
    }
  }
}

/**
 * Ends a process tree: SIGTERM to the group immediately, escalating to SIGKILL after a grace period
 * so a wedged process (a language server mid-load, a build that ignores the request) cannot linger.
 * The escalation timer never holds the event loop open. On Windows the tree is force-killed at once.
 * @param pid The group leader's process identifier.
 * @param graceMs How long to wait before escalating to SIGKILL.
 * @param kill The signal primitive, injectable for testing.
 */
export function killProcessTree(
  pid: number,
  graceMs: number = DEFAULT_KILL_GRACE_MS,
  kill: (pid: number, signal: NodeJS.Signals) => unknown = (
    target: number,
    name: NodeJS.Signals,
  ): boolean => process.kill(target, name),
): void {
  if (process.platform === 'win32') {
    signalProcessTree(pid, 'SIGKILL', kill);
    return;
  }
  signalProcessTree(pid, 'SIGTERM', kill);
  const escalation: NodeJS.Timeout = setTimeout((): void => {
    signalProcessTree(pid, 'SIGKILL', kill);
  }, graceMs);
  escalation.unref();
}
