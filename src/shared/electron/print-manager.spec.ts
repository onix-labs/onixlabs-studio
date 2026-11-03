import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportPdfResult, PrintChannel, PrintResult } from '@shared/api/print-channels';

/**
 * Holds what the mocked Electron and file-system layers saw: the registered IPC handlers, the PDF
 * and print options the sender was given, the files written, and the paths opened.
 */
const captured: {
  handlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
  pdfOptions: Record<string, unknown>[];
  printOptions: Record<string, unknown>[];
  written: string[];
  opened: string[];
  backgrounds: string[];
} = vi.hoisted(() => ({
  backgrounds: [],
  handlers: new Map<string, (event: unknown, request: unknown) => Promise<unknown>>(),
  pdfOptions: [],
  printOptions: [],
  written: [],
  opened: [],
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, request: unknown) => Promise<unknown>,
    ): void => void captured.handlers.set(channel, handler),
  },
  // The requesting window is on screen, so the save dialog is parented to it and answers at once.
  BrowserWindow: {
    fromWebContents: (): object => ({
      getBackgroundColor: (): string => '#000000',
      setBackgroundColor: (colour: string): void => void captured.backgrounds.push(colour),
      isVisible: (): boolean => true,
      isDestroyed: (): boolean => false,
    }),
    getFocusedWindow: (): null => null,
  },
  dialog: {
    showSaveDialog: (): Promise<{ canceled: boolean; filePath: string }> =>
      Promise.resolve({ canceled: false, filePath: '/out/notes.pdf' }),
  },
  shell: {
    openPath: (path: string): Promise<string> => (captured.opened.push(path), Promise.resolve('')),
  },
}));

vi.mock('node:fs/promises', () => ({
  writeFile: (path: string): Promise<void> => (captured.written.push(path), Promise.resolve()),
}));

const { PrintManager } = await import('./print-manager');

/**
 * Builds an invocation event whose sender records the options it prints and exports with.
 * @returns Returns the event.
 */
function event(): unknown {
  return {
    sender: {
      printToPDF: (options: Record<string, unknown>): Promise<Buffer> => {
        captured.pdfOptions.push(options);
        return Promise.resolve(Buffer.from('%PDF'));
      },
      print: (
        options: Record<string, unknown>,
        callback: (success: boolean, failureReason: string) => void,
      ): void => {
        captured.printOptions.push(options);
        callback(true, '');
      },
    },
  };
}

/**
 * Invokes a registered handler.
 * @param channel The channel.
 * @param request The request.
 * @returns Returns the handler's result.
 */
function invoke<T>(channel: string, request: unknown): Promise<T> {
  const handler: ((event: unknown, request: unknown) => Promise<unknown>) | undefined =
    captured.handlers.get(channel);
  if (handler === undefined) {
    throw new Error(`No handler for ${channel}`);
  }
  return handler(event(), request) as Promise<T>;
}

describe('PrintManager', () => {
  beforeEach(() => {
    captured.handlers.clear();
    captured.pdfOptions.length = 0;
    captured.printOptions.length = 0;
    captured.written.length = 0;
    captured.opened.length = 0;
    captured.backgrounds.length = 0;
    new PrintManager().register();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exportPdf_withAPage_rendersOnItsPaperAndOrientation', async () => {
    await invoke<ExportPdfResult>(PrintChannel.ExportPdf, {
      defaultFileName: 'notes.pdf',
      page: { pageSize: 'Letter', landscape: true, printBackground: true },
    });

    expect(captured.pdfOptions[0]).toMatchObject({
      pageSize: 'Letter',
      landscape: true,
      printBackground: true,
      displayHeaderFooter: false,
    });
  });

  it('exportPdf_withBackgrounds_whitensTheWindowWhileItRenders', async () => {
    // The margin band is painted in the window's own (black) background once backgrounds print.
    await invoke<ExportPdfResult>(PrintChannel.ExportPdf, {
      defaultFileName: 'notes.pdf',
      page: { pageSize: 'A4', landscape: false, printBackground: true },
    });

    expect(captured.backgrounds).toEqual(['#FFFFFF', '#000000']);
  });

  it('exportPdf_withoutBackgrounds_leavesTheWindowAlone', async () => {
    await invoke<ExportPdfResult>(PrintChannel.ExportPdf, { defaultFileName: 'notes.pdf' });

    expect(captured.backgrounds).toEqual([]);
  });

  it('exportPdf_withoutAPage_isPortraitA4WithoutBackgrounds', async () => {
    await invoke<ExportPdfResult>(PrintChannel.ExportPdf, { defaultFileName: 'notes.pdf' });

    expect(captured.pdfOptions[0]).toMatchObject({
      pageSize: 'A4',
      landscape: false,
      printBackground: false,
    });
  });

  it('exportPdf_withAMalformedPaper_fallsBackToA4', async () => {
    await invoke<ExportPdfResult>(PrintChannel.ExportPdf, {
      defaultFileName: 'notes.pdf',
      page: { pageSize: 'Tabloid', landscape: 'yes' },
    });

    expect(captured.pdfOptions[0]).toMatchObject({ pageSize: 'A4', landscape: false });
  });

  it('exportPdf_withAHeader_escapesTheFileNameIntoTheTemplate', async () => {
    await invoke<ExportPdfResult>(PrintChannel.ExportPdf, {
      defaultFileName: 'notes.pdf',
      page: {
        pageSize: 'A4',
        landscape: false,
        printBackground: false,
        headerTitle: '<b>x</b>.md',
      },
    });

    const options: Record<string, unknown> = captured.pdfOptions[0];
    expect(options['displayHeaderFooter']).toBe(true);
    expect(options['headerTemplate']).toContain('&#60;b&#62;x&#60;/b&#62;.md');
    expect(options['headerTemplate']).not.toContain('<b>');
    expect(options['footerTemplate']).toContain("class='pageNumber'");
  });

  it('exportPdf_opensTheFinishedPdfUnlessAskedNotTo', async () => {
    await invoke<ExportPdfResult>(PrintChannel.ExportPdf, { defaultFileName: 'notes.pdf' });
    expect(captured.opened).toEqual(['/out/notes.pdf']);

    captured.opened.length = 0;
    const result: ExportPdfResult = await invoke<ExportPdfResult>(PrintChannel.ExportPdf, {
      defaultFileName: 'notes.pdf',
      openAfterExport: false,
    });
    expect(captured.opened).toEqual([]);
    expect(result).toEqual({ success: true, path: '/out/notes.pdf' });
  });

  it('print_withAHeader_asksChromiumForItsHeaderAndFooter', async () => {
    const result: PrintResult = await invoke<PrintResult>(PrintChannel.Print, {
      page: { pageSize: 'A4', landscape: false, printBackground: true, headerTitle: 'notes.md' },
    });

    expect(result).toEqual({ success: true });
    expect(captured.printOptions[0]).toEqual({ printBackground: true, header: 'notes.md' });
  });

  it('print_withoutAHeader_printsNone', async () => {
    await invoke<PrintResult>(PrintChannel.Print, {
      page: { pageSize: 'A4', landscape: false, printBackground: false },
    });

    expect(captured.printOptions[0]).toEqual({ printBackground: false });
  });
});
