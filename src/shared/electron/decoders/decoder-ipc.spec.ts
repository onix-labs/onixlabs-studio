import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  MockInstance,
  vi,
} from 'vitest';
import { BinaryChannel } from '@shared/api/binary-channels';

/**
 * What the fake Electron answers: the temp directory standing in for userData, and what was registered
 * on `ipcMain`.
 */
const electron: {
  userData: string | null;
  handlers: Map<string, (...args: unknown[]) => unknown>;
} = vi.hoisted(() => ({
  userData: null,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  app: {
    // ⛔ Contributed decoders are read from installed plugins under userData. It is a temp directory
    // here or nothing: asking while it is unset throws rather than falling through to the real one.
    getPath: (): string => {
      if (electron.userData === null) {
        throw new Error('The spec has no userData.');
      }
      return electron.userData;
    },
    getAppPath: (): string => electron.userData ?? '',
    getVersion: (): string => '0.0.0',
    isReady: (): boolean => false,
    isPackaged: false,
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown): void =>
      void electron.handlers.set(channel, handler),
  },
  shell: {},
}));

const { DecoderHost } = await import('./decoder-ipc');
const { Decoders } = await import('./decoders');
const { JitCapture } = await import('./jit-capture');

describe('DecoderHost', () => {
  const bytes: Uint8Array = new Uint8Array([0x90]);
  let host: InstanceType<typeof DecoderHost>;
  let decode: MockInstance<InstanceType<typeof Decoders>['decode']>;
  let info: MockInstance<InstanceType<typeof Decoders>['info']>;
  let capture: MockInstance<InstanceType<typeof JitCapture>['capture']>;

  /**
   * Calls a channel as the renderer would.
   * @param channel The channel.
   * @param args The arguments.
   * @returns Returns the handler's answer.
   */
  function call(channel: BinaryChannel, ...args: unknown[]): unknown {
    const handler: ((...args: unknown[]) => unknown) | undefined = electron.handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`Nothing handles ${channel}.`);
    }
    return handler({}, ...args);
  }

  beforeAll(() => {
    electron.userData = mkdtempSync(join(tmpdir(), 'decoder-ipc-'));
  });

  afterAll(() => {
    if (electron.userData !== null) {
      rmSync(electron.userData, { recursive: true, force: true });
    }
    electron.userData = null;
  });

  beforeEach(() => {
    electron.handlers.clear();
    // Replaced, so neither a decoder nor `dotnet` can be started from here.
    decode = vi.spyOn(Decoders.prototype, 'decode').mockResolvedValue(null);
    info = vi.spyOn(Decoders.prototype, 'info').mockResolvedValue(null);
    capture = vi
      .spyOn(JitCapture.prototype, 'capture')
      .mockResolvedValue({ ok: false, error: 'not run' });
    host = new DecoderHost();
    host.register();
  });

  afterEach(() => {
    host.dispose();
    vi.restoreAllMocks();
  });

  describe('decoding', () => {
    it.each<[string, readonly unknown[]]>([
      ['noFormat', [undefined, bytes, 0]],
      ['anEmptyFormat', ['', bytes, 0]],
      ['aFormatOfTheWrongType', [7, bytes, 0]],
      ['noBytes', ['elf/x64', undefined, 0]],
      ['emptyBytes', ['elf/x64', new Uint8Array(0), 0]],
      ['aPlainArrayOfBytes', ['elf/x64', [0x90], 0]],
      ['aStringOfBytes', ['elf/x64', 'nop', 0]],
      ['noOffset', ['elf/x64', bytes, undefined]],
      ['aNegativeOffset', ['elf/x64', bytes, -1]],
      ['aFractionalOffset', ['elf/x64', bytes, 0.5]],
      ['anOffsetThatIsNotANumber', ['elf/x64', bytes, Number.NaN]],
      ['anInfiniteOffset', ['elf/x64', bytes, Number.POSITIVE_INFINITY]],
      ['aStringOffset', ['elf/x64', bytes, '0']],
    ])('refuses_%s', async (_name: string, args: readonly unknown[]) => {
      expect(await call(BinaryChannel.DecodeListing, ...args)).toBeNull();
      expect(decode).not.toHaveBeenCalled();
    });

    it('passesAWellFormedRequestThrough', async () => {
      await call(BinaryChannel.DecodeListing, 'elf/x64', bytes, 16, 1024, '/fixture/a.out', {
        'a.pdb': bytes,
      });

      expect(decode).toHaveBeenCalledWith('elf/x64', bytes, 16, 1024, '/fixture/a.out', {
        'a.pdb': bytes,
      });
    });

    it('dropsOptionalFieldsOfTheWrongType', async () => {
      await call(BinaryChannel.DecodeListing, 'elf/x64', bytes, 0, 'big', 7, 'none');

      expect(decode).toHaveBeenCalledWith('elf/x64', bytes, 0, undefined, undefined, undefined);
    });

    it('keepsOnlyCompanionsThatAreBytes', async () => {
      await call(BinaryChannel.DecodeListing, 'elf/x64', bytes, 0, undefined, undefined, {
        good: bytes,
        empty: new Uint8Array(0),
        text: 'not bytes',
        missing: null,
      });

      expect(decode.mock.calls[0][5]).toEqual({ good: bytes });
    });

    it('sendsNoCompanions_whenNoneSurvive', async () => {
      await call(BinaryChannel.DecodeListing, 'elf/x64', bytes, 0, undefined, undefined, {
        text: 'not bytes',
      });

      expect(decode.mock.calls[0][5]).toBeUndefined();
    });
  });

  describe('describing', () => {
    it.each<[string, unknown]>([
      ['nothing', undefined],
      ['anEmptyFormat', ''],
      ['aNumber', 7],
    ])('answersNull_for_%s', async (_name: string, format: unknown) => {
      expect(await call(BinaryChannel.DecoderInfo, format)).toBeNull();
      expect(info).not.toHaveBeenCalled();
    });

    it('asksForAWellFormedFormat', async () => {
      await call(BinaryChannel.DecoderInfo, 'elf/x64');

      expect(info).toHaveBeenCalledWith('elf/x64');
    });
  });

  describe('JIT capture', () => {
    it.each<[string, unknown]>([
      ['nothing', undefined],
      ['anEmptyPath', ''],
      ['aNumber', 7],
    ])('refuses_%s', async (_name: string, assemblyPath: unknown) => {
      expect(await call(BinaryChannel.JitCapture, assemblyPath, '*', 'tier0')).toEqual({
        ok: false,
        error: 'No assembly to run.',
      });
      expect(capture).not.toHaveBeenCalled();
    });

    it('defaultsThePattern_andTheOptimisedTier', async () => {
      await call(BinaryChannel.JitCapture, '/fixture/a.dll', '', 'anything');
      await call(BinaryChannel.JitCapture, '/fixture/a.dll', 7, undefined);

      expect(capture.mock.calls).toEqual([
        ['/fixture/a.dll', '*', 'full-opts'],
        ['/fixture/a.dll', '*', 'full-opts'],
      ]);
    });

    it('honoursAWellFormedRequest', async () => {
      await call(BinaryChannel.JitCapture, '/fixture/a.dll', 'Main', 'tier0');

      expect(capture).toHaveBeenCalledWith('/fixture/a.dll', 'Main', 'tier0');
    });
  });
});
