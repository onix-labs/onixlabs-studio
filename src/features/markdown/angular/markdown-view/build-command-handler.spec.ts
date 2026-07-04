import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { MarkdownCommandHandler } from '@shared/angular/services/markdown-commands/markdown-commands';
import { MarkdownClipboard } from './markdown-clipboard';
import { OutlineScrollSpy } from './outline-scroll-spy';
import { buildMarkdownCommandHandler } from './build-command-handler';

describe('buildMarkdownCommandHandler', () => {
  it('routesEachCommandToItsCollaborator', () => {
    const insertParsedBlock: (markdown: string) => void = vi.fn();
    const goToHeading: (index: number) => void = vi.fn();
    const setBlockType: (blockType: string) => void = vi.fn();
    const handler: MarkdownCommandHandler = buildMarkdownCommandHandler({
      clipboard: { insertParsedBlock } as unknown as MarkdownClipboard,
      outline: { goToHeading } as unknown as OutlineScrollSpy,
      paneOf: (): MarkdownEditor | undefined => undefined,
      setBlockType,
    });

    handler.insertMarkdown('# x');
    handler.goToHeading(3);
    handler.setBlockType('heading-1');

    expect(insertParsedBlock).toHaveBeenCalledWith('# x');
    expect(goToHeading).toHaveBeenCalledWith(3);
    expect(setBlockType).toHaveBeenCalledWith('heading-1');
  });

  it('paneCommands_whenNoPane_areNoOpsAndReadReturnsEmpty', () => {
    const handler: MarkdownCommandHandler = buildMarkdownCommandHandler({
      clipboard: {} as unknown as MarkdownClipboard,
      outline: {} as unknown as OutlineScrollSpy,
      paneOf: (): MarkdownEditor | undefined => undefined,
      setBlockType: (): void => undefined,
    });

    expect((): void => handler.undo()).not.toThrow();
    expect((): void => handler.toggleBold()).not.toThrow();
    expect(handler.readDocument()).toBe('');
  });
});
