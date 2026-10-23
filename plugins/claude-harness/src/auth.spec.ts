import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  type AuthPorts,
  type AuthState,
  bundledExecutable,
  extractLoginUrl,
  parseStatus,
  runAuth,
} from './auth';

/**
 * A stand-in for the CLI's login process: output a test writes, and an exit it triggers.
 */
class FakeLogin extends EventEmitter {
  public readonly stdout: EventEmitter = new EventEmitter();
  public readonly stderr: EventEmitter = new EventEmitter();
  public killed: boolean = false;

  /**
   * Records the kill.
   * @returns Returns true.
   */
  public kill(): boolean {
    this.killed = true;
    return true;
  }
}

/**
 * Ports that record what they ran, and the login process once started.
 */
interface FakePorts {
  readonly ports: AuthPorts;
  readonly ran: string[];
  login: FakeLogin | null;
}

/**
 * Builds ports whose status check answers `statusOut`, recording every command run.
 * @param statusOut What `claude auth status --json` prints, or null for a failed check.
 * @returns Returns the ports, what they ran, and the login process once started.
 */
function fakePorts(statusOut: string | null): FakePorts {
  const record: FakePorts = {
    ran: [],
    login: null,
    ports: {
      run: (_file: string, args: readonly string[]) => {
        record.ran.push(args.join(' '));
        return Promise.resolve(
          args[1] === 'status'
            ? { ok: statusOut !== null, stdout: statusOut ?? '' }
            : { ok: true, stdout: '' },
        );
      },
      start: (_file: string, args: readonly string[]): ChildProcess => {
        record.ran.push(args.join(' '));
        record.login = new FakeLogin();
        return record.login as unknown as ChildProcess;
      },
    },
  };
  return record;
}

/**
 * Lets the promise callbacks queued so far run.
 * @returns Returns once they have.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve): void => void setTimeout(resolve, 0));
}

describe('parseStatus', () => {
  it('readsASignedInUserAndTheirAccount', () => {
    expect(parseStatus('{"loggedIn": true, "email": "someone@example.com"}')).toEqual({
      phase: 'signed-in',
      account: 'someone@example.com',
    });
  });

  it('readsAnythingButAnExplicitLoginAsSignedOut', () => {
    // A changed or unreadable payload offers sign-in rather than assuming a login.
    expect(parseStatus('{"loggedIn": false}')).toEqual({ phase: 'signed-out' });
    expect(parseStatus('{"loggedIn": "yes"}')).toEqual({ phase: 'signed-out' });
    expect(parseStatus('not json')).toEqual({ phase: 'signed-out' });
    expect(parseStatus('null')).toEqual({ phase: 'signed-out' });
  });
});

describe('extractLoginUrl', () => {
  it('findsTheSignInPageTheCliPrints', () => {
    // As CLI 2.1.261 prints it with plain pipes.
    const output: string =
      'Opening browser to sign in…\n' +
      "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=x\n" +
      'Paste code here if prompted >';
    expect(extractLoginUrl(output)).toBe(
      'https://claude.com/cai/oauth/authorize?code=true&state=x',
    );
  });

  it('trimsPunctuationAroundTheAddress', () => {
    expect(extractLoginUrl('(see https://example.com/sign-in).')).toBe(
      'https://example.com/sign-in',
    );
    expect(extractLoginUrl('no address yet')).toBeUndefined();
  });
});

describe('bundledExecutable', () => {
  it('findsTheSdksBinaryBesideThePlugin', () => {
    const root: string = mkdtempSync(join(tmpdir(), 'claude-harness-'));
    try {
      const entry: string = join(root, 'node_modules', '@onixlabs', 'claude-harness');
      const sdk: string = join(
        root,
        'node_modules',
        '@anthropic-ai',
        'claude-agent-sdk-darwin-x64',
      );
      mkdirSync(entry, { recursive: true });
      mkdirSync(sdk, { recursive: true });
      writeFileSync(join(sdk, 'claude'), '');

      expect(bundledExecutable(entry, 'darwin', 'x64')).toBe(join(sdk, 'claude'));
      expect(bundledExecutable(entry, 'linux', 'arm64')).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('findsNothingOutsideAnInstall', () => {
    expect(bundledExecutable('/')).toBeUndefined();
  });
});

describe('runAuth', () => {
  it('status_settlesOnWhatTheCliSays', async () => {
    const fake: FakePorts = fakePorts('{"loggedIn": true}');
    const states: AuthState[] = [];
    runAuth('status', 'claude', (state: AuthState): void => void states.push(state), fake.ports);
    await flush();

    expect(fake.ran).toEqual(['auth status --json']);
    expect(states).toEqual([{ phase: 'signed-in' }]);
  });

  it('status_readsAFailedCheckAsSignedOut', async () => {
    const fake: FakePorts = fakePorts(null);
    const states: AuthState[] = [];
    runAuth('status', 'claude', (state: AuthState): void => void states.push(state), fake.ports);
    await flush();

    expect(states).toEqual([{ phase: 'signed-out' }]);
  });

  it('logout_signsOutAndThenReportsTheStatus', async () => {
    const fake: FakePorts = fakePorts('{"loggedIn": false}');
    const states: AuthState[] = [];
    runAuth('logout', 'claude', (state: AuthState): void => void states.push(state), fake.ports);
    await flush();

    expect(fake.ran).toEqual(['auth logout', 'auth status --json']);
    expect(states).toEqual([{ phase: 'signed-out' }]);
  });

  it('login_reportsTheBrowserPageAndSettlesSignedIn', async () => {
    const fake: FakePorts = fakePorts('{"loggedIn": true, "email": "someone@example.com"}');
    const states: AuthState[] = [];
    runAuth('login', 'claude', (state: AuthState): void => void states.push(state), fake.ports);
    fake.login?.stdout.emit('data', Buffer.from('Opening browser to sign in…\n'));
    fake.login?.stdout.emit('data', Buffer.from('visit: https://example.com/sign-in\n'));
    fake.login?.stdout.emit('data', Buffer.from('Paste code here if prompted >'));
    fake.login?.emit('exit', 0);
    await flush();

    expect(fake.ran).toEqual(['auth login --claudeai', 'auth status --json']);
    expect(states).toEqual([
      { phase: 'starting' },
      { phase: 'browser' },
      { phase: 'browser', url: 'https://example.com/sign-in' },
      { phase: 'signed-in', account: 'someone@example.com' },
    ]);
  });

  it('login_settlesSignedOutWithTheCliLastWords', async () => {
    const fake: FakePorts = fakePorts('{"loggedIn": false}');
    const states: AuthState[] = [];
    runAuth('login', 'claude', (state: AuthState): void => void states.push(state), fake.ports);
    fake.login?.stderr.emit('data', 'Login failed: the code expired\n');
    fake.login?.emit('exit', 1);
    await flush();

    expect(states.at(-1)).toEqual({
      phase: 'signed-out',
      detail: 'Login failed: the code expired',
    });
  });

  it('login_stopsTheCliWhenAskedAndOnlyThen', async () => {
    const fake: FakePorts = fakePorts('{"loggedIn": true}');
    const stop: () => void = runAuth('login', 'claude', (): void => undefined, fake.ports);
    stop();
    expect(fake.login?.killed).toBe(true);

    const settled: FakePorts = fakePorts('{"loggedIn": true}');
    const stopSettled: () => void = runAuth(
      'login',
      'claude',
      (): void => undefined,
      settled.ports,
    );
    settled.login?.emit('exit', 0);
    await flush();
    stopSettled();
    expect(settled.login?.killed).toBe(false);
  });
});
