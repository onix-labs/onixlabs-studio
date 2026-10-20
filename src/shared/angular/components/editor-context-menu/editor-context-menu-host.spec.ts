import { Component, Injectable, Signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import type * as MonacoApi from 'monaco-editor';
import type { Mock, MockInstance } from 'vitest';
import { EditorContextMenu } from '@shared/angular/services/editor-context-menu/editor-context-menu';
import { EditorContextMenuHost } from './editor-context-menu-host';

/**
 * An overlay container of its own, standing in for a popped-out dock's or a modal's window: what the
 * window-scoped CDK providers give the components drawn there.
 */
@Injectable()
class WindowOverlayContainer extends OverlayContainer {
  /**
   * Creates the container element, marked so the spec can tell it from the root one.
   */
  protected override _createContainer(): void {
    const element: HTMLElement = document.createElement('div');
    element.classList.add('cdk-overlay-container', 'window-overlay-container');
    document.body.appendChild(element);
    this._containerElement = element;
  }
}

/**
 * An editor's view in a secondary window: the host, under that window's overlay container.
 */
@Component({
  imports: [EditorContextMenuHost],
  template: '<app-editor-context-menu />',
  providers: [{ provide: OverlayContainer, useClass: WindowOverlayContainer }],
})
class WindowView {
  /**
   * Gets the host under test.
   */
  public readonly host: Signal<EditorContextMenuHost> =
    viewChild.required<EditorContextMenuHost>(EditorContextMenuHost);
}

describe('EditorContextMenuHost (#1012)', () => {
  let fixture: ComponentFixture<WindowView>;
  let editor: MonacoApi.editor.ICodeEditor;
  let focus: Mock<() => void>;
  let container: HTMLElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    focus = vi.fn<() => void>();
    editor = {
      getContainerDomNode: (): HTMLElement => container,
      focus,
    } as unknown as MonacoApi.editor.ICodeEditor;
    fixture = TestBed.createComponent(WindowView);
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
    container.remove();
    document.querySelectorAll('.window-overlay-container').forEach((element: Element): void => {
      element.remove();
    });
  });

  /**
   * Opens the menu with Copy and Select All, as a read-only editor's right-click would.
   * @returns Returns the right-click event.
   */
  async function openMenu(): Promise<MouseEvent> {
    const event: MouseEvent = new MouseEvent('contextmenu', {
      clientX: 40,
      clientY: 60,
      button: 2,
      cancelable: true,
    });
    fixture.componentInstance.host().open(event, {
      editor,
      items: [
        { id: 'copy', label: 'Copy', shortcut: '⌘C' },
        { id: 'selectAll', label: 'Select All', shortcut: '⌘A' },
      ],
    });
    await fixture.whenStable();
    return event;
  }

  /**
   * Finds the rows of the open menu in the window's overlay container.
   * @returns Returns the row buttons.
   */
  function rows(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>('.window-overlay-container .app-menu-panel__item'),
    );
  }

  it('open_drawsTheMenuInTheEditorsWindow_atThePointer_andConsumesTheRightClick', async () => {
    const event: MouseEvent = await openMenu();

    expect(rows().map((row: HTMLElement): string => row.textContent?.trim() ?? '')).toEqual([
      'Copy⌘C',
      'Select All⌘A',
    ]);
    // Never in the main window's container: a secondary window is a separate OS window.
    const root: HTMLElement = TestBed.inject(OverlayContainer).getContainerElement();
    expect(root.querySelector('.app-menu-panel')).toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });

  it('choosingARow_runsItsCommandOnTheEditor_onceTheMenuHasClosed', async () => {
    const run: MockInstance<EditorContextMenu['run']> = vi
      .spyOn(TestBed.inject(EditorContextMenu), 'run')
      .mockImplementation((): void => undefined);
    await openMenu();

    rows()[0].click();

    expect(run).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith('copy', editor);
    expect(rows()).toEqual([]);
  });

  it('aMenuWithRowsOfItsOwn_runsThemItself_notTheRightClickCommands (#1016)', async () => {
    const run: MockInstance<EditorContextMenu['run']> = vi
      .spyOn(TestBed.inject(EditorContextMenu), 'run')
      .mockImplementation((): void => undefined);
    const ran: string[] = [];
    fixture.componentInstance
      .host()
      .open(
        new MouseEvent('contextmenu', { clientX: 40, clientY: 60, button: 0, cancelable: true }),
        {
          editor,
          items: [{ id: 'quick-fix-0', label: 'Add import' }],
          run: (id: string): void => void ran.push(id),
        },
      );
    await fixture.whenStable();

    rows()[0].click();
    await Promise.resolve();

    expect(ran).toEqual(['quick-fix-0']);
    expect(run).not.toHaveBeenCalled();
  });

  it('dismissing_givesTheEditorFocusBack', async () => {
    await openMenu();
    const panel: HTMLElement | null = document.querySelector<HTMLElement>(
      '.window-overlay-container .app-menu-panel',
    );

    panel?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }),
    );
    await Promise.resolve();

    expect(rows()).toEqual([]);
    expect(focus).toHaveBeenCalled();
  });

  it('reopening_showsTheNewRightClicksRows_notTheFirsts', async () => {
    // CDK keeps the panel's portal, context and all, from the first open.
    await openMenu();
    document
      .querySelector<HTMLElement>('.window-overlay-container .app-menu-panel')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await fixture.whenStable();
    expect(rows()).toEqual([]);

    fixture.componentInstance
      .host()
      .open(new MouseEvent('contextmenu', { clientX: 1, clientY: 1, cancelable: true }), {
        editor,
        items: [{ id: 'find', label: 'Find…', shortcut: '⌘F' }],
      });
    await fixture.whenStable();

    expect(rows().map((row: HTMLElement): string => row.textContent?.trim() ?? '')).toEqual([
      'Find…⌘F',
    ]);
  });
});
