import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { MarkdownClipboard } from './markdown-clipboard';

/**
 * Builds a clipboard over a fixed pane (or none), for driving its commands in isolation.
 * @param pane The fake pane the clipboard drives, or undefined to model an absent editor.
 * @returns Returns the clipboard under test.
 */
function clipboardOver(pane: MarkdownEditor | undefined): MarkdownClipboard {
  return new MarkdownClipboard((): MarkdownEditor | undefined => pane);
}

describe('MarkdownClipboard', () => {
  let execCommand: (command: string) => boolean;

  beforeEach((): void => {
    // happy-dom does not implement execCommand, so install a stub the native cut/copy path targets.
    execCommand = vi.fn((): boolean => true);
    (document as unknown as { execCommand: (command: string) => boolean }).execCommand =
      execCommand;
  });

  it('clipboardCommand_whenRun_focusesThePaneAndRunsTheNativeCommand', () => {
    const focusEditor: () => void = vi.fn();
    const clipboard: MarkdownClipboard = clipboardOver({
      focusEditor,
    } as unknown as MarkdownEditor);

    clipboard.clipboardCommand('cut');

    expect(focusEditor).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledWith('cut');
  });

  it('insertRawText_whenRun_runsOneEditorActionAgainstThePane', () => {
    const run: (...args: unknown[]) => void = vi.fn();
    const clipboard: MarkdownClipboard = clipboardOver({ run } as unknown as MarkdownEditor);

    clipboard.insertRawText('hello');

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('copyPlaintext_whenNoCrepe_isANoOp', () => {
    const clipboard: MarkdownClipboard = clipboardOver({
      getCrepe: (): null => null,
    } as unknown as MarkdownEditor);

    expect((): void => clipboard.copyPlaintext()).not.toThrow();
  });

  it('commands_whenPaneAbsent_doNotThrow', () => {
    const clipboard: MarkdownClipboard = clipboardOver(undefined);

    // Guards the pane recreation race: the editor is nulled and rebuilt on external content loads, so
    // every command must tolerate an absent pane rather than address a stale one.
    expect((): void => clipboard.clipboardCommand('copy')).not.toThrow();
    expect((): void => clipboard.copyPlaintext()).not.toThrow();
    expect((): void => clipboard.cutPlaintext()).not.toThrow();
    expect((): void => clipboard.insertParsedBlock('x')).not.toThrow();
    expect((): void => clipboard.insertParsedInline('x')).not.toThrow();
    expect((): void => clipboard.insertRawText('x')).not.toThrow();
    expect((): void => clipboard.appendParsedBlock('x')).not.toThrow();
  });
});
