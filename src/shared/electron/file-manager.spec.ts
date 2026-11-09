import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileChannel } from '@shared/api/file-channels';
import type { FileInfo, FileWriteResult } from '@shared/api/file-channels';
import type { BrowserWindow } from 'electron';

/**
 * Describes an IPC handler as the fake `ipcMain` captures it.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Holds the fake Electron layer: the registered handlers, what each dialog will answer, and the
 * options the dialogs were last shown with.
 */
const electron: {
  handlers: Map<string, Handler>;
  chosen: string[];
  savePath: string | undefined;
  response: number;
  openOptions: Record<string, unknown> | undefined;
  messageOptions: Record<string, unknown> | undefined;
} = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  chosen: [],
  savePath: undefined,
  response: 0,
  openOptions: undefined,
  messageOptions: undefined,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void =>
      void electron.handlers.set(channel, handler),
  },
  BrowserWindow: {
    fromWebContents: (): null => null,
    getFocusedWindow: (): null => null,
  },
  dialog: {
    showOpenDialog: (
      options: Record<string, unknown>,
    ): Promise<{ canceled: boolean; filePaths: string[] }> => {
      electron.openOptions = options;
      return Promise.resolve({
        canceled: electron.chosen.length === 0,
        filePaths: electron.chosen,
      });
    },
    showSaveDialog: (): Promise<{ canceled: boolean; filePath: string | undefined }> =>
      Promise.resolve({ canceled: electron.savePath === undefined, filePath: electron.savePath }),
    showMessageBox: (options: Record<string, unknown>): Promise<{ response: number }> => {
      electron.messageOptions = options;
      return Promise.resolve({ response: electron.response });
    },
  },
}));

const { FileManager } = await import('./file-manager');
const { TrustedPaths } = await import('./trusted-paths');
const { WorkspaceContext } = await import('./workspace-context');

describe('FileManager', () => {
  let directory: string;
  let trusted: InstanceType<typeof TrustedPaths>;
  let workspace: InstanceType<typeof WorkspaceContext>;

  /**
   * Invokes a captured IPC handler as the renderer would.
   * @param channel The channel to invoke.
   * @param args The renderer-supplied arguments.
   * @returns Returns what the handler answered.
   */
  async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const handler: Handler | undefined = electron.handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`Nothing registered ${channel}`);
    }
    return (await handler({ sender: {} }, ...args)) as T;
  }

  /**
   * Writes a fixture file.
   * @param name The file's name.
   * @param content The file's content.
   * @returns Returns the file's absolute path.
   */
  function fixture(name: string, content: string | Buffer = 'hello'): string {
    const file: string = path.join(directory, name);
    fs.writeFileSync(file, content);
    return file;
  }

  beforeEach(() => {
    directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'file-manager-')));
    electron.handlers.clear();
    electron.chosen = [];
    electron.savePath = undefined;
    electron.response = 0;
    electron.openOptions = undefined;
    electron.messageOptions = undefined;
    trusted = new TrustedPaths(path.join(directory, 'trusted.json'));
    workspace = new WorkspaceContext();
    workspace.addRoot(directory);
    new FileManager((): BrowserWindow | null => null, trusted, workspace).register();
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  describe('read', () => {
    it('read_describesTheFile', async () => {
      const file: string = fixture('notes.md', 'hello');

      expect(await invoke(FileChannel.Read, file)).toEqual({
        path: file,
        name: 'notes.md',
        extension: '.md',
        content: 'hello',
        encoding: 'utf8',
        hasBom: false,
      });
    });

    it.each([[undefined], [null], [''], [42], [{}], [['a']]])(
      'read_withAnUnusablePath_answersNull %#',
      async (filePath: unknown) => {
        expect(await invoke(FileChannel.Read, filePath)).toBeNull();
      },
    );

    it('read_ofAMissingFile_answersNull', async () => {
      expect(await invoke(FileChannel.Read, path.join(directory, 'gone.txt'))).toBeNull();
    });

    it('read_ofADirectory_answersNull', async () => {
      expect(await invoke(FileChannel.Read, directory)).toBeNull();
    });

    it('read_ofAFileItCannotOpen_answersNull', async () => {
      const file: string = fixture('locked.txt');
      fs.chmodSync(file, 0o000);

      expect(await invoke(FileChannel.Read, file)).toBeNull();
    });

    it('read_ofAFifo_answersNull_ratherThanWaitingForAWriterForever', async () => {
      const pipe: string = path.join(directory, 'pipe.txt');
      execFileSync('mkfifo', [pipe]);

      expect(await invoke(FileChannel.Read, pipe)).toBeNull();
    });

    it('read_withANulInThePath_answersNull', async () => {
      expect(await invoke(FileChannel.Read, `${directory}/a\0b`)).toBeNull();
    });

    it('read_throughALink_namesTheLinkNotItsTarget', async () => {
      const target: string = fixture('target.txt', 'real');
      const link: string = path.join(directory, 'link.txt');
      fs.symlinkSync(target, link);

      expect(await invoke<FileInfo>(FileChannel.Read, link)).toMatchObject({
        path: link,
        name: 'link.txt',
        content: 'real',
      });
    });

    it('read_ofADanglingLink_answersNull', async () => {
      const link: string = path.join(directory, 'link.txt');
      fs.symlinkSync(path.join(directory, 'gone.txt'), link);

      expect(await invoke(FileChannel.Read, link)).toBeNull();
    });

    it('read_stripsAUtf8ByteOrderMark_andRecordsIt', async () => {
      const file: string = fixture(
        'bom.txt',
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hi')]),
      );

      expect(await invoke<FileInfo>(FileChannel.Read, file)).toMatchObject({
        content: 'hi',
        hasBom: true,
      });
    });

    it('read_withAForcedEncoding_decodesAccordingly', async () => {
      const file: string = fixture('latin.txt', Buffer.from([0xe9]));

      expect(
        await invoke<FileInfo>(FileChannel.Read, file, { encoding: 'iso88591' }),
      ).toMatchObject({ content: 'é', encoding: 'iso88591' });
    });

    it('read_withUnusableDecodeOptions_tellsTheEncodingFromTheBytes', async () => {
      const file: string = fixture('plain.txt', 'hi');

      expect(await invoke<FileInfo>(FileChannel.Read, file, { encoding: 'klingon' })).toMatchObject(
        { content: 'hi', encoding: 'utf8' },
      );
    });

    it('read_ofAFileWithoutAnExtension_reportsNone', async () => {
      const file: string = fixture('Makefile');

      expect(await invoke<FileInfo>(FileChannel.Read, file)).toMatchObject({ extension: '' });
    });
  });

  describe('write', () => {
    it('write_replacesTheContent', async () => {
      const file: string = fixture('a.txt', 'a long original');

      const result: FileWriteResult = await invoke(FileChannel.Write, file, 'short');

      expect(result).toEqual({ success: true, path: file });
      expect(fs.readFileSync(file, 'utf8')).toBe('short');
    });

    it.each([[undefined], [null], [''], [42]])(
      'write_withAnUnusablePath_isRefused %#',
      async (filePath: unknown) => {
        expect(await invoke(FileChannel.Write, filePath, 'x')).toEqual({
          success: false,
          error: 'Invalid file path',
        });
      },
    );

    it.each([[undefined], [null], [42], [{}], [Buffer.from('x')]])(
      'write_withUnusableContent_leavesTheFile %#',
      async (content: unknown) => {
        const file: string = fixture('a.txt', 'kept');

        expect(await invoke(FileChannel.Write, file, content)).toEqual({
          success: false,
          error: 'Invalid file content',
        });

        expect(fs.readFileSync(file, 'utf8')).toBe('kept');
      },
    );

    it('write_ofTheEmptyString_emptiesTheFile', async () => {
      const file: string = fixture('a.txt', 'gone');

      expect((await invoke<FileWriteResult>(FileChannel.Write, file, '')).success).toBe(true);

      expect(fs.readFileSync(file).length).toBe(0);
    });

    it('write_putsTheByteOrderMarkBack', async () => {
      const file: string = fixture('a.txt');

      await invoke(FileChannel.Write, file, 'hi', true, 'utf8');

      expect([...fs.readFileSync(file)]).toEqual([0xef, 0xbb, 0xbf, 0x68, 0x69]);
    });

    it('write_withAHasBomThatIsNotTrue_addsNone', async () => {
      const file: string = fixture('a.txt');

      await invoke(FileChannel.Write, file, 'hi', 'true', 'utf8');

      expect(fs.readFileSync(file, 'utf8')).toBe('hi');
    });

    it('write_inAnEncodingNotUnderstood_writesUtf8', async () => {
      const file: string = fixture('a.txt');

      await invoke(FileChannel.Write, file, 'é', false, 'klingon');

      expect(fs.readFileSync(file, 'utf8')).toBe('é');
    });

    it('write_ofACharacterTheEncodingCannotHold_refusesAndKeepsTheFile', async () => {
      const file: string = fixture('a.txt', 'kept');

      const result: FileWriteResult = await invoke(
        FileChannel.Write,
        file,
        '日本語',
        false,
        'iso88591',
      );

      expect(result.success).toBe(false);
      expect(fs.readFileSync(file, 'utf8')).toBe('kept');
    });

    it('write_roundTripsEachEncoding', async () => {
      const file: string = fixture('a.txt');

      for (const encoding of ['utf8', 'utf16le', 'utf16be'] as const) {
        await invoke(FileChannel.Write, file, 'héllo', true, encoding);

        expect(await invoke<FileInfo>(FileChannel.Read, file), encoding).toMatchObject({
          content: 'héllo',
          encoding,
          hasBom: true,
        });
      }
    });

    it('write_intoAMissingFolder_failsWithoutCreatingIt', async () => {
      const file: string = path.join(directory, 'gone', 'a.txt');

      const result: FileWriteResult = await invoke(FileChannel.Write, file, 'x');

      expect(result.success).toBe(false);
      expect(fs.existsSync(path.dirname(file))).toBe(false);
    });

    it('write_overADirectory_failsCleanly', async () => {
      const result: FileWriteResult = await invoke(FileChannel.Write, directory, 'x');

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('write_toAReadOnlyFile_failsAndKeepsIt', async () => {
      const file: string = fixture('locked.txt', 'kept');
      fs.chmodSync(file, 0o444);

      const result: FileWriteResult = await invoke(FileChannel.Write, file, 'x');

      expect(result.success).toBe(false);
      expect(fs.readFileSync(file, 'utf8')).toBe('kept');
    });

    it('write_throughALink_keepsTheLinkAndChangesItsTarget', async () => {
      const target: string = fixture('target.txt', 'old');
      const link: string = path.join(directory, 'link.txt');
      fs.symlinkSync(target, link);

      await invoke(FileChannel.Write, link, 'new');

      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(target, 'utf8')).toBe('new');
    });

    it('write_keepsTheFilesPermissions', async () => {
      const file: string = fixture('run.sh', '#!/bin/sh\n');
      fs.chmodSync(file, 0o755);

      await invoke(FileChannel.Write, file, '#!/bin/sh\necho\n');

      expect(fs.statSync(file).mode & 0o777).toBe(0o755);
    });

    it('write_concurrently_endsWithOneWholeSave_neverABlend', async () => {
      const file: string = fixture('a.txt');
      const saves: readonly string[] = [6, 1, 5, 2, 4, 3].map((megabytes: number): string =>
        String(megabytes).repeat(megabytes * 1024 * 1024),
      );

      const results: readonly FileWriteResult[] = await Promise.all(
        saves.map((content: string): Promise<FileWriteResult> =>
          invoke(FileChannel.Write, file, content),
        ),
      );

      expect(results.every((result: FileWriteResult): boolean => result.success)).toBe(true);
      expect(saves.includes(fs.readFileSync(file, 'utf8'))).toBe(true);
    });
  });

  describe('writeBytes', () => {
    it('writeBytes_createsTheFoldersItNeeds', async () => {
      const file: string = path.join(directory, 'a', 'b', 'export.xlsx');

      const result: FileWriteResult = await invoke(
        FileChannel.WriteBytes,
        file,
        new Uint8Array([1, 2, 3]),
      );

      expect(result).toEqual({ success: true, path: file });
      expect([...fs.readFileSync(file)]).toEqual([1, 2, 3]);
    });

    it.each([[undefined], [null], [[1, 2]], ['bytes'], [new ArrayBuffer(2)]])(
      'writeBytes_withSomethingNotBytes_isRefused %#',
      async (bytes: unknown) => {
        const file: string = path.join(directory, 'a.bin');

        expect(await invoke(FileChannel.WriteBytes, file, bytes)).toEqual({
          success: false,
          error: 'Invalid file content',
        });

        expect(fs.existsSync(file)).toBe(false);
      },
    );

    it.each([[undefined], [''], [7]])(
      'writeBytes_withAnUnusablePath_isRefused %#',
      async (filePath: unknown) => {
        expect(await invoke(FileChannel.WriteBytes, filePath, new Uint8Array(1))).toEqual({
          success: false,
          error: 'Invalid file path',
        });
      },
    );

    it('writeBytes_underAFile_failsCleanly', async () => {
      const file: string = fixture('plain.txt');

      const result: FileWriteResult = await invoke(
        FileChannel.WriteBytes,
        path.join(file, 'child.bin'),
        new Uint8Array(1),
      );

      expect(result.success).toBe(false);
    });
  });

  describe('boundary', () => {
    let outside: string;
    let secret: string;
    let temporary: string | undefined;

    beforeEach(() => {
      outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'file-manager-outside-')));
      secret = path.join(outside, 'id_ed25519');
      fs.writeFileSync(secret, 'secret');
      temporary = process.env['TMPDIR'];
    });

    afterEach(() => {
      if (temporary === undefined) {
        delete process.env['TMPDIR'];
      } else {
        process.env['TMPDIR'] = temporary;
      }
      fs.rmSync(outside, { recursive: true, force: true });
    });

    it('read_outsideEverything_answersNull', async () => {
      expect(await invoke(FileChannel.Read, secret)).toBeNull();
    });

    it('read_escapingAWorkspaceByTraversal_answersNull', async () => {
      const escaping: string = `${directory}/../${path.basename(outside)}/id_ed25519`;

      expect(await invoke(FileChannel.Read, escaping)).toBeNull();
    });

    it('write_outsideEverything_isRefusedAndLeavesTheFile', async () => {
      const result: FileWriteResult = await invoke(FileChannel.Write, secret, 'overwritten');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Save As');
      expect(fs.readFileSync(secret, 'utf8')).toBe('secret');
    });

    it('write_ofANewFileOutsideEverything_createsNothing', async () => {
      const file: string = path.join(outside, 'new.txt');

      expect((await invoke<FileWriteResult>(FileChannel.Write, file, 'x')).success).toBe(false);

      expect(fs.existsSync(file)).toBe(false);
    });

    it('writeBytes_outsideEverything_isRefusedAndCreatesNothing', async () => {
      const file: string = path.join(outside, 'deep', 'new.bin');

      const result: FileWriteResult = await invoke(
        FileChannel.WriteBytes,
        file,
        new Uint8Array([1]),
      );

      expect(result.success).toBe(false);
      expect(fs.existsSync(path.dirname(file))).toBe(false);
    });

    it('read_throughALinkPlantedInTheWorkspace_answersNull', async () => {
      const link: string = path.join(directory, 'planted');
      fs.symlinkSync(secret, link);

      expect(await invoke(FileChannel.Read, link)).toBeNull();
    });

    it('write_throughALinkPlantedInTheWorkspace_leavesItsTarget', async () => {
      const link: string = path.join(directory, 'planted');
      fs.symlinkSync(secret, link);

      expect((await invoke<FileWriteResult>(FileChannel.Write, link, 'x')).success).toBe(false);

      expect(fs.readFileSync(secret, 'utf8')).toBe('secret');
    });

    it('write_throughADanglingLinkInTheWorkspace_createsNothing', async () => {
      const target: string = path.join(outside, 'created-by-the-link');
      const link: string = path.join(directory, 'planted');
      fs.symlinkSync(target, link);

      expect((await invoke<FileWriteResult>(FileChannel.Write, link, 'x')).success).toBe(false);

      expect(fs.existsSync(target)).toBe(false);
    });

    it('write_intoAFolderLinkedOutOfTheWorkspace_isRefused', async () => {
      const link: string = path.join(directory, 'planted');
      fs.symlinkSync(outside, link);

      const result: FileWriteResult = await invoke(
        FileChannel.Write,
        path.join(link, 'id_ed25519'),
        'x',
      );

      expect(result.success).toBe(false);
      expect(fs.readFileSync(secret, 'utf8')).toBe('secret');
    });

    it('write_toALinkTheRendererOpenedInTheWorkspace_isStillRefused', async () => {
      // Opening a workspace file remembers its name, and the agent's shell can replace a file by a link.
      const link: string = path.join(directory, 'planted');
      fs.symlinkSync(secret, link);
      trusted.remember(link);

      expect((await invoke<FileWriteResult>(FileChannel.Write, link, 'x')).success).toBe(false);

      expect(fs.readFileSync(secret, 'utf8')).toBe('secret');
    });

    it('write_toALinkBetweenTwoOpenWorkspaces_succeeds', async () => {
      workspace.addRoot(outside);
      const link: string = path.join(directory, 'shared');
      fs.symlinkSync(secret, link);

      expect((await invoke<FileWriteResult>(FileChannel.Write, link, 'x')).success).toBe(true);

      expect(fs.readFileSync(secret, 'utf8')).toBe('x');
    });

    it('read_inAWorkspaceReachedThroughALink_isAllowed', async () => {
      const linked: string = path.join(outside, 'linked-root');
      fs.symlinkSync(directory, linked);
      workspace.removeRoot(directory);
      workspace.addRoot(linked);
      fixture('inside.txt', 'hello');

      expect(
        await invoke<FileInfo>(FileChannel.Read, path.join(linked, 'inside.txt')),
      ).toMatchObject({ content: 'hello' });
    });

    it('read_afterItsWorkspaceClosed_answersNull', async () => {
      const file: string = fixture('inside.txt');
      workspace.removeRoot(directory);

      expect(await invoke(FileChannel.Read, file)).toBeNull();
    });

    it('recentFile_trustedFromAnEarlierSession_readsAndSaves', async () => {
      trusted.remember(secret);

      expect(await invoke<FileInfo>(FileChannel.Read, secret)).toMatchObject({ content: 'secret' });
      expect((await invoke<FileWriteResult>(FileChannel.Write, secret, 'x')).success).toBe(true);
    });

    it('recentFile_trustedThroughALinkedFolder_stillReads', async () => {
      // macOS's /tmp and /var are links; an entry from before links were followed names the link.
      const linkedFolder: string = path.join(outside, 'tmp');
      fs.symlinkSync(outside, linkedFolder);
      const name: string = path.join(linkedFolder, 'id_ed25519');
      trusted.remember(name);

      expect(await invoke<FileInfo>(FileChannel.Read, name)).toMatchObject({ content: 'secret' });
    });

    it('openDialog_thenSaveTheDocument_writesTheChosenFile', async () => {
      electron.chosen = [secret];

      await invoke(FileChannel.OpenFileDialog);

      expect((await invoke<FileWriteResult>(FileChannel.Write, secret, 'x')).success).toBe(true);
    });

    it('saveDialog_thenWrite_createsTheChosenFileOutsideTheWorkspace', async () => {
      const chosen: string = path.join(outside, 'export.json');
      electron.savePath = chosen;

      await invoke(FileChannel.SaveFileDialog);

      expect((await invoke<FileWriteResult>(FileChannel.Write, chosen, 'x')).success).toBe(true);
      expect(fs.readFileSync(chosen, 'utf8')).toBe('x');
    });

    it('saveDialog_thenWriteBytes_writesTheChosenSpreadsheet', async () => {
      const chosen: string = path.join(outside, 'export.xlsx');
      electron.savePath = chosen;

      await invoke(FileChannel.SaveFileDialog);

      expect(
        (await invoke<FileWriteResult>(FileChannel.WriteBytes, chosen, new Uint8Array([1])))
          .success,
      ).toBe(true);
    });

    it('saveDialog_ontoALinkInTheWorkspace_writesThroughIt', async () => {
      // Chosen in the dialog, so it is the user's decision and not a planted link.
      const link: string = path.join(directory, 'chosen-link');
      fs.symlinkSync(secret, link);
      electron.savePath = link;

      await invoke(FileChannel.SaveFileDialog);

      expect((await invoke<FileWriteResult>(FileChannel.Write, link, 'x')).success).toBe(true);
    });

    it('pickPath_ofAFile_thenRead_importsIt', async () => {
      electron.chosen = [secret];

      await invoke(FileChannel.PickPath, 'file', false);

      expect(await invoke<FileInfo>(FileChannel.Read, secret)).toMatchObject({ content: 'secret' });
    });

    it('pickPath_ofAFolder_grantsNothingInsideIt', async () => {
      electron.chosen = [outside];

      await invoke(FileChannel.PickPath, 'folder', false);

      expect(await invoke(FileChannel.Read, secret)).toBeNull();
    });

    it('read_ofADecompiledSource_opensForGoToDefinition', async () => {
      process.env['TMPDIR'] = outside;
      const folder: string = path.join(outside, 'MetadataAsSource', 'abc');
      fs.mkdirSync(folder, { recursive: true });
      const file: string = path.join(folder, 'IList.cs');
      fs.writeFileSync(file, 'interface IList {}');

      expect(await invoke<FileInfo>(FileChannel.Read, file)).toMatchObject({
        name: 'IList.cs',
        content: 'interface IList {}',
      });
    });

    it('read_ofACratesSource_opensForGoToDefinition_andAWriteToItIsRefused (#1210)', async () => {
      const cargoHome: string | undefined = process.env['CARGO_HOME'];
      process.env['CARGO_HOME'] = path.join(outside, 'cargo');
      try {
        const folder: string = path.join(outside, 'cargo', 'registry', 'src', 'index', 'serde');
        fs.mkdirSync(folder, { recursive: true });
        const file: string = path.join(folder, 'lib.rs');
        fs.writeFileSync(file, 'pub trait Serialize {}');

        expect(await invoke<FileInfo>(FileChannel.Read, file)).toMatchObject({
          content: 'pub trait Serialize {}',
        });
        expect(await invoke(FileChannel.Write, file, 'changed')).toMatchObject({ success: false });
        expect(fs.readFileSync(file, 'utf8')).toBe('pub trait Serialize {}');
      } finally {
        if (cargoHome === undefined) {
          delete process.env['CARGO_HOME'];
        } else {
          process.env['CARGO_HOME'] = cargoHome;
        }
      }
    });

    it('write_ofADecompiledSource_isRefused', async () => {
      process.env['TMPDIR'] = outside;
      const folder: string = path.join(outside, 'MetadataAsSource', 'abc');
      fs.mkdirSync(folder, { recursive: true });
      const file: string = path.join(folder, 'IList.cs');
      fs.writeFileSync(file, 'interface IList {}');

      expect((await invoke<FileWriteResult>(FileChannel.Write, file, 'x')).success).toBe(false);

      expect(fs.readFileSync(file, 'utf8')).toBe('interface IList {}');
    });

    it('read_ofALinkPlantedInTheDecompiledFolder_answersNull', async () => {
      process.env['TMPDIR'] = outside;
      const folder: string = path.join(outside, 'MetadataAsSource');
      fs.mkdirSync(folder, { recursive: true });
      const link: string = path.join(folder, 'planted.cs');
      fs.symlinkSync(secret, link);

      expect(await invoke(FileChannel.Read, link)).toBeNull();
    });
  });

  describe('dialogs', () => {
    it('openDialog_whenCancelled_answersNothing', async () => {
      expect(await invoke(FileChannel.OpenFileDialog)).toEqual([]);
    });

    it('openDialog_skipsAFileItCannotRead_andKeepsTheOthers', async () => {
      const first: string = fixture('first.txt', '1');
      const second: string = fixture('second.txt', '2');
      electron.chosen = [first, path.join(directory, 'gone.txt'), second];

      const opened: readonly FileInfo[] = await invoke(FileChannel.OpenFileDialog);

      expect(opened.map((file: FileInfo): string => file.content)).toEqual(['1', '2']);
    });

    it('openDialog_doesNotHangOnAFifoAmongTheChosenFiles', async () => {
      const pipe: string = path.join(directory, 'pipe.txt');
      execFileSync('mkfifo', [pipe]);
      const file: string = fixture('real.txt', 'real');
      electron.chosen = [pipe, file];

      const opened: readonly FileInfo[] = await invoke(FileChannel.OpenFileDialog);

      expect(opened.map((entry: FileInfo): string => entry.path)).toEqual([file]);
    });

    it('pickImage_answersThePathWithoutReadingIt', async () => {
      electron.chosen = [path.join(directory, 'never-created.png')];

      expect(await invoke(FileChannel.PickImage)).toBe(electron.chosen[0]);
    });

    it('pickImage_whenCancelled_answersNull', async () => {
      expect(await invoke(FileChannel.PickImage)).toBeNull();
    });

    it.each([
      ['folder', true, ['openDirectory']],
      ['folder', false, ['openDirectory']],
      ['file', true, ['openFile', 'multiSelections']],
      ['file', false, ['openFile']],
      ['file', 'yes', ['openFile']],
      ['anything else', false, ['openFile']],
    ])(
      'pickPaths_asks %s with multiple %s',
      async (kind: string, multiple: unknown, properties: readonly string[]) => {
        await invoke(FileChannel.PickPath, kind, multiple);

        expect(electron.openOptions).toMatchObject({ properties });
      },
    );

    it('pickPaths_answersEveryChoice_orNothingWhenCancelled', async () => {
      expect(await invoke(FileChannel.PickPath, 'file', true)).toEqual([]);

      electron.chosen = ['/a', '/b'];

      expect(await invoke(FileChannel.PickPath, 'file', true)).toEqual(['/a', '/b']);
    });

    it('saveDialog_remembersTheChosenPath_soItCanBeReopened', async () => {
      const chosen: string = path.join(directory, 'saved.txt');
      electron.savePath = chosen;

      expect(await invoke(FileChannel.SaveFileDialog, 42)).toBe(chosen);

      expect(trusted.has(chosen)).toBe(true);
    });

    it.each([[undefined], ['']])(
      'saveDialog_whenCancelled_remembersNothing %#',
      async (savePath: string | undefined) => {
        electron.savePath = savePath;

        expect(await invoke(FileChannel.SaveFileDialog)).toBeNull();

        expect(trusted.list()).toEqual([]);
      },
    );

    it.each([
      [0, 'save'],
      [1, 'dontSave'],
      [2, 'cancel'],
      [99, 'cancel'],
    ])('confirmSave_readsButton %i as %s', async (response: number, expected: string) => {
      electron.response = response;

      expect(await invoke(FileChannel.ConfirmSave, 'a.txt')).toBe(expected);
    });

    it('confirmSave_withANonStringName_stillAsks', async () => {
      await invoke(FileChannel.ConfirmSave, 42);

      expect(electron.messageOptions).toMatchObject({
        message: 'Do you want to save changes to ""?',
        cancelId: 2,
      });
    });

    it.each([
      [undefined],
      [null],
      ['delete everything'],
      [42],
      [{}],
      [{ title: 't', message: 'm', detail: 'd' }],
      [{ title: 't', message: 'm', detail: 7, confirmLabel: 'Delete' }],
    ])('confirmDestructive_withAMalformedRequest_neverConfirms %#', async (request: unknown) => {
      electron.response = 0;

      expect(await invoke(FileChannel.ConfirmDestructive, request)).toBe(false);

      expect(electron.messageOptions).toBeUndefined();
    });

    it('confirmDestructive_makesCancelTheDefaultAndEscapeAction', async () => {
      electron.response = 1;
      const request: unknown = { title: 't', message: 'm', detail: 'd', confirmLabel: 'Delete' };

      expect(await invoke(FileChannel.ConfirmDestructive, request)).toBe(false);

      expect(electron.messageOptions).toMatchObject({
        buttons: ['Delete', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
      });
    });

    it('confirmDestructive_confirmsOnlyOnTheConfirmButton', async () => {
      electron.response = 0;
      const request: unknown = { title: 't', message: 'm', detail: 'd', confirmLabel: 'Delete' };

      expect(await invoke(FileChannel.ConfirmDestructive, request)).toBe(true);
    });
  });
});
