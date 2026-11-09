import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecurityChannel } from '@shared/api/security-channels';

/**
 * Describes an IPC handler as the fake `ipcMain` captures it.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Describes the header listener the session is given.
 */
type HeaderListener = (
  details: { responseHeaders: Record<string, string[]> },
  callback: (response: { responseHeaders: Record<string, string[]> }) => void,
) => void;

/**
 * Holds the fake Electron layer.
 */
const electron: {
  handlers: Map<string, Handler>;
  listener: HeaderListener | undefined;
  userData: string;
} = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  listener: undefined,
  userData: '',
}));

vi.mock('electron', () => ({
  app: { getPath: (): string => electron.userData },
  ipcMain: {
    handle: (channel: string, handler: Handler): void =>
      void electron.handlers.set(channel, handler),
  },
  protocol: { registerSchemesAsPrivileged: (): void => undefined },
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived: (listener: HeaderListener): void => {
          electron.listener = listener;
        },
      },
    },
  },
}));

const { SecurityManager } = await import('./security-manager');

describe('SecurityManager', () => {
  /**
   * Answers the policy a response is given.
   * @param headers The headers the response arrived with.
   * @returns Returns the headers it leaves with.
   */
  function respond(headers: Record<string, string[]> = {}): Record<string, string[]> {
    let answered: Record<string, string[]> = {};
    electron.listener?.({ responseHeaders: headers }, (response): void => {
      answered = response.responseHeaders;
    });
    return answered;
  }

  /**
   * Reads one directive out of the policy.
   * @param name The directive.
   * @returns Returns its sources.
   */
  function directive(name: string): string {
    const policy: string = respond()['Content-Security-Policy']?.[0] ?? '';
    return policy.split('; ').find((entry: string): boolean => entry.startsWith(`${name} `)) ?? '';
  }

  /**
   * Gets the path of the store.
   * @returns Returns the path.
   */
  function store(): string {
    return path.join(electron.userData, 'security.json');
  }

  beforeEach(() => {
    electron.userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'security-')));
    electron.handlers.clear();
    vi.stubEnv('ELECTRON_START_URL', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(electron.userData, { recursive: true, force: true });
  });

  it('policy_defaultsToHttpsImages', () => {
    new SecurityManager().register();

    expect(directive('img-src')).toContain('https:');
    expect(directive('img-src')).not.toContain('http: ');
    expect(directive('img-src').endsWith('http:')).toBe(false);
  });

  it('policy_forbidsWhatARenderedDocumentCouldAbuse', () => {
    new SecurityManager().register();

    expect(directive('script-src')).not.toContain('unsafe-inline');
    expect(directive('connect-src')).toBe("connect-src 'self'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('frame-src')).toBe("frame-src 'none'");
    expect(directive('form-action')).toBe("form-action 'none'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
  });

  it('policy_keepsTheResponsesOtherHeaders', () => {
    new SecurityManager().register();

    expect(respond({ 'X-Other': ['kept'] })['X-Other']).toEqual(['kept']);
  });

  it('policy_inDevelopment_relaxesOnlyConnections', () => {
    vi.stubEnv('ELECTRON_START_URL', 'http://localhost:4200');

    new SecurityManager().register();

    expect(directive('connect-src')).toContain('ws:');
    expect(directive('script-src')).not.toContain('unsafe-inline');
  });

  it.each([
    ['local', false, false],
    ['https', true, false],
    ['all', true, true],
  ])(
    'setImagePolicy %s_shapesTheImageSources',
    async (value: string, https: boolean, http: boolean) => {
      new SecurityManager().register();

      expect(await electron.handlers.get(SecurityChannel.SetImagePolicy)?.({}, value)).toBe(value);

      const sources: readonly string[] = directive('img-src').split(' ');
      expect(sources.includes('https:')).toBe(https);
      expect(sources.includes('http:')).toBe(http);
    },
  );

  it.each([[undefined], [null], [7], ['everything'], [{}]])(
    'setImagePolicy_withAnUnknownValue_keepsTheCurrentOne %#',
    async (value: unknown) => {
      new SecurityManager().register();

      expect(await electron.handlers.get(SecurityChannel.SetImagePolicy)?.({}, value)).toBe(
        'https',
      );

      expect(fs.existsSync(store())).toBe(false);
    },
  );

  it('setImagePolicy_survivesARestart', async () => {
    new SecurityManager().register();
    await electron.handlers.get(SecurityChannel.SetImagePolicy)?.({}, 'all');

    new SecurityManager().register();

    expect(await electron.handlers.get(SecurityChannel.GetImagePolicy)?.({})).toBe('all');
    expect(fs.statSync(store()).mode & 0o777).toBe(0o600);
  });

  it.each([['{ corrupt'], ['null'], ['{"imagePolicy":"everything"}'], ['[]']])(
    'load_ofAnUnusableStore_fallsBackToHttps %#',
    async (contents: string) => {
      fs.writeFileSync(store(), contents);

      new SecurityManager().register();

      expect(await electron.handlers.get(SecurityChannel.GetImagePolicy)?.({})).toBe('https');
    },
  );

  it('save_thatFails_stillAppliesThePolicyThisSession', async () => {
    fs.mkdirSync(store());
    new SecurityManager().register();

    expect(await electron.handlers.get(SecurityChannel.SetImagePolicy)?.({}, 'local')).toBe(
      'local',
    );
  });
});
