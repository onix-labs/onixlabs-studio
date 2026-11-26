import { TestBed } from '@angular/core/testing';
import { TabDocks } from '@shared/angular/services/dock-layout/tab-docks';

import { EDITOR_TERMINAL_PANEL_ID, EditorTerminals } from './editor-terminals';

describe('EditorTerminals', () => {
  let editorTerminals: EditorTerminals;

  beforeEach(() => {
    editorTerminals = TestBed.inject(EditorTerminals);
  });

  it('queueCommand_storesItAndOpensTheTabsTerminal', () => {
    const opened: string[] = [];
    TestBed.inject(TabDocks).register('tab-1', {
      isOpen: (): boolean => false,
      open: (panelId: string): void => void opened.push(panelId),
      close: (): void => undefined,
      toggle: (): void => undefined,
    });

    editorTerminals.queueCommand('tab-1', 'node run.js');

    expect(opened).toEqual([EDITOR_TERMINAL_PANEL_ID]);
    expect(editorTerminals.pending('tab-1')).toBe('node run.js');
  });

  it('takePending_whenPending_returnsAndClears', () => {
    editorTerminals.queueCommand('tab-1', 'node run.js');
    expect(editorTerminals.takePending('tab-1')).toBe('node run.js');
    expect(editorTerminals.pending('tab-1')).toBeNull();
    expect(editorTerminals.takePending('tab-1')).toBeNull();
  });

  it('remove_forgetsOnlyThatTabsCommand', () => {
    editorTerminals.queueCommand('tab-1', 'one');
    editorTerminals.queueCommand('tab-2', 'two');

    editorTerminals.remove('tab-1');

    expect(editorTerminals.pending('tab-1')).toBeNull();
    expect(editorTerminals.pending('tab-2')).toBe('two');
  });
});
