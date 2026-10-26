import { beforeEach, describe, expect, it } from 'vitest';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RibbonStripMenuButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { Icon } from '@shared/angular/icons/icon';
import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { MenuContribution, MenuEntry } from '@shared/angular/services/app-menu/app-menu-model';
import {
  ConnectionTarget,
  DatabaseExplorerCommandHandler,
  DatabaseExplorerCommands,
  RibbonPanel,
} from '../database-explorer-commands/database-explorer-commands';
import { DatabaseExplorerRibbon } from './database-explorer-ribbon';

/**
 * Exposes the protected members the Save menu button is wired to, so its dropdown can be exercised
 * without opening the overlay.
 */
interface DatabaseExplorerRibbonInternals {
  onSaveVariant(id: string): void;
}

/**
 * A handler recording every command it is given, with writable state for the ribbon to show.
 */
class RecordingHandler implements DatabaseExplorerCommandHandler {
  /**
   * Holds every command the handler ran, in order.
   */
  public readonly calls: string[] = [];

  public readonly canExecute: WritableSignal<boolean> = signal<boolean>(false);
  public readonly executing: WritableSignal<boolean> = signal<boolean>(false);
  public readonly connectionTarget: WritableSignal<ConnectionTarget | null> =
    signal<ConnectionTarget | null>(null);
  public readonly panels: WritableSignal<readonly RibbonPanel[]> = signal<readonly RibbonPanel[]>(
    [],
  );
  public readonly hasPassphrase: WritableSignal<boolean> = signal<boolean>(false);
  public readonly locked: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Records an execute.
   */
  public execute(): void {
    this.calls.push('execute');
  }

  /**
   * Records a new query.
   */
  public newQuery(): void {
    this.calls.push('newQuery');
  }

  /**
   * Records a new connection.
   */
  public newConnection(): void {
    this.calls.push('newConnection');
  }

  /**
   * Records a save.
   */
  public saveDocument(): void {
    this.calls.push('save');
  }

  /**
   * Records a save-as.
   */
  public saveDocumentAs(): void {
    this.calls.push('saveAs');
  }

  /**
   * Records a layout reset.
   */
  public resetLayout(): void {
    this.calls.push('resetLayout');
  }

  /**
   * Records a connect or disconnect.
   */
  public toggleConnection(): void {
    this.calls.push('toggleConnection');
  }

  /**
   * Records a connection refresh.
   */
  public refreshConnection(): void {
    this.calls.push('refreshConnection');
  }

  /**
   * Records a connection edit.
   */
  public editConnection(): void {
    this.calls.push('editConnection');
  }

  /**
   * Records a panel toggle.
   * @param id The panel's id.
   */
  public togglePanel(id: string): void {
    this.calls.push(`togglePanel:${id}`);
  }

  /**
   * Records a passphrase being set.
   */
  public setPassphrase(): void {
    this.calls.push('setPassphrase');
  }

  /**
   * Records a passphrase being removed.
   */
  public removePassphrase(): void {
    this.calls.push('removePassphrase');
  }

  /**
   * Records an unlock.
   */
  public unlockPassphrase(): void {
    this.calls.push('unlockPassphrase');
  }
}

/**
 * The tab's tool panels as the view reports them: the Object Explorer showing, the terminal not.
 */
const PANELS: readonly RibbonPanel[] = [
  { id: 'objects', title: 'Object Explorer', icon: Icon.DATABASE_OBJECTS, open: true },
  { id: 'terminal', title: 'Terminal', icon: Icon.TERMINAL, open: false },
];

describe('DatabaseExplorerRibbon', () => {
  let fixture: ComponentFixture<DatabaseExplorerRibbon>;
  let internals: DatabaseExplorerRibbonInternals;
  let host: HTMLElement;
  let menu: AppMenu;
  let handler: RecordingHandler;

  /**
   * Re-renders after the handler's state changes, and lets the menu contribution re-run.
   */
  function refresh(): void {
    fixture.detectChanges();
    TestBed.tick();
  }

  /**
   * Finds a ribbon group by its title.
   * @param title The group's title.
   * @returns Returns the group element.
   */
  function group(title: string): HTMLElement {
    const match: HTMLElement | undefined = Array.from(
      host.querySelectorAll<HTMLElement>('.ribbon-group'),
    ).find(
      (element: HTMLElement): boolean =>
        element.querySelector('.ribbon-group__title')?.textContent?.trim() === title,
    );
    if (match === undefined) {
      throw new Error(`No group titled "${title}"`);
    }
    return match;
  }

  /**
   * Finds a button in a group by its visible label.
   * @param title The group's title.
   * @param label The button's label.
   * @returns Returns the button element.
   */
  function button(title: string, label: string): HTMLButtonElement {
    const match: HTMLButtonElement | undefined = Array.from(
      group(title).querySelectorAll<HTMLButtonElement>('button'),
    ).find((element: HTMLButtonElement): boolean => element.textContent?.trim() === label);
    if (match === undefined) {
      throw new Error(`No button labelled "${label}" in "${title}"`);
    }
    return match;
  }

  /**
   * Lists the visible labels of a group's buttons.
   * @param title The group's title.
   * @returns Returns the labels, in order.
   */
  function labels(title: string): readonly string[] {
    return Array.from(group(title).querySelectorAll<HTMLButtonElement>('button'))
      .map((element: HTMLButtonElement): string => element.textContent?.trim() ?? '')
      .filter((label: string): boolean => label.length > 0);
  }

  /**
   * Reads the icon classes a button draws.
   * @param element The button.
   * @returns Returns the icon's class list.
   */
  function iconOf(element: HTMLButtonElement): string {
    return element.querySelector('i')?.className ?? '';
  }

  /**
   * Reads the Save menu button's dropdown labels.
   * @returns Returns the labels, in order.
   */
  function saveItems(): readonly string[] {
    const save: RibbonStripMenuButton = fixture.debugElement.query(
      By.directive(RibbonStripMenuButton),
    ).componentInstance as RibbonStripMenuButton;
    return save.items().map((item: { readonly label: string }): string => item.label);
  }

  /**
   * Reads a section of the contributed app menu.
   * @param id The section's id.
   * @returns Returns the section's entries, separators included.
   */
  function section(id: string): readonly MenuEntry[] {
    return (
      menu.sections().find((candidate: MenuContribution): boolean => candidate.id === id)?.items ??
      []
    );
  }

  /**
   * Finds a contributed menu entry by its command id.
   * @param sectionId The section's id.
   * @param id The entry's command id.
   * @returns Returns the entry.
   */
  function entry(sectionId: string, id: string): MenuEntry {
    const match: MenuEntry | undefined = section(sectionId).find(
      (candidate: MenuEntry): boolean => candidate.id === id,
    );
    if (match === undefined) {
      throw new Error(`No menu entry "${id}" in "${sectionId}"`);
    }
    return match;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DatabaseExplorerRibbon],
    }).compileComponents();

    handler = new RecordingHandler();
    TestBed.inject(DatabaseExplorerCommands).register(handler);
    fixture = TestBed.createComponent(DatabaseExplorerRibbon);
    internals = fixture.componentInstance as unknown as DatabaseExplorerRibbonInternals;
    host = fixture.nativeElement as HTMLElement;
    menu = TestBed.inject(AppMenu);
    fixture.detectChanges();
    await fixture.whenStable();
    TestBed.tick();
  });

  it('groups_whenRendered_areFileConnectionQueryAndTools', () => {
    const titles: readonly string[] = Array.from(host.querySelectorAll('.ribbon-group__title')).map(
      (title: Element): string => title.textContent?.trim() ?? '',
    );

    expect(titles).toEqual(['File', 'Connection', 'Query', 'Tools']);
  });

  it('connectionGroup_whenRendered_offersNewConnectRefreshAndEdit', () => {
    expect(labels('Connection')).toEqual(['New', 'Connect', 'Refresh', 'Edit']);
  });

  it('connectionButtons_withNoTarget_offerOnlyNew', () => {
    expect(button('Connection', 'New').disabled).toBe(false);
    expect(button('Connection', 'Connect').disabled).toBe(true);
    expect(button('Connection', 'Refresh').disabled).toBe(true);
    expect(button('Connection', 'Edit').disabled).toBe(true);
  });

  it('connect_withAClosedTarget_isOfferedWithItsIcon', () => {
    handler.connectionTarget.set({ id: 'c1', name: 'Production', state: 'closed' });
    refresh();

    const connect: HTMLButtonElement = button('Connection', 'Connect');
    expect(connect.disabled).toBe(false);
    expect(iconOf(connect)).toBe(Icon.DATABASE_CONNECT.classList);
    expect(button('Connection', 'Refresh').disabled).toBe(true);
    expect(button('Connection', 'Edit').disabled).toBe(false);
  });

  it('connect_whileConnecting_isDisabled', () => {
    handler.connectionTarget.set({ id: 'c1', name: 'Production', state: 'connecting' });
    refresh();

    expect(button('Connection', 'Connect').disabled).toBe(true);
    expect(button('Connection', 'Refresh').disabled).toBe(true);
    expect(button('Connection', 'Edit').disabled).toBe(false);
  });

  it('connect_withAnOpenTarget_becomesDisconnect', () => {
    handler.connectionTarget.set({ id: 'c1', name: 'Production', state: 'open' });
    refresh();

    expect(labels('Connection')).toEqual(['New', 'Disconnect', 'Refresh', 'Edit']);
    const disconnect: HTMLButtonElement = button('Connection', 'Disconnect');
    expect(disconnect.disabled).toBe(false);
    expect(iconOf(disconnect)).toBe(Icon.DATABASE_DISCONNECT.classList);
    expect(button('Connection', 'Refresh').disabled).toBe(false);
  });

  it('connectionButtons_whenPressed_reachTheHandler', () => {
    handler.connectionTarget.set({ id: 'c1', name: 'Production', state: 'open' });
    refresh();

    button('Connection', 'New').click();
    button('Connection', 'Disconnect').click();
    button('Connection', 'Refresh').click();
    button('Connection', 'Edit').click();

    expect(handler.calls).toEqual([
      'newConnection',
      'toggleConnection',
      'refreshConnection',
      'editConnection',
    ]);
  });

  it('execute_whenTheQueryCannotRun_isDisabled', () => {
    expect(button('Query', 'Execute').disabled).toBe(true);
    expect(iconOf(button('Query', 'Execute'))).toBe(Icon.PLAY.classList);
  });

  it('execute_whileRunning_becomesCancel', () => {
    handler.canExecute.set(true);
    handler.executing.set(true);
    refresh();

    expect(labels('Query')).toEqual(['New', 'Cancel']);
    expect(iconOf(button('Query', 'Cancel'))).toBe(Icon.STOP.classList);
  });

  it('queryButtons_whenPressed_reachTheHandler', () => {
    handler.canExecute.set(true);
    refresh();

    button('Query', 'New').click();
    button('Query', 'Execute').click();

    expect(handler.calls).toEqual(['newQuery', 'execute']);
  });

  it('tools_withNoPanels_offerOnlyResetLayout', () => {
    expect(labels('Tools')).toEqual(['Reset Layout']);
  });

  it('tools_offerAToggleForEachPanel_pressedWhileItShows', () => {
    handler.panels.set(PANELS);
    refresh();

    expect(labels('Tools')).toEqual(['Object Explorer', 'Terminal', 'Reset Layout']);
    expect(button('Tools', 'Object Explorer').getAttribute('aria-pressed')).toBe('true');
    expect(button('Tools', 'Terminal').getAttribute('aria-pressed')).toBe('false');
    expect(iconOf(button('Tools', 'Terminal'))).toBe(Icon.TERMINAL.classList);
  });

  it('tools_whenPressed_toggleThePanelOrResetTheLayout', () => {
    handler.panels.set(PANELS);
    refresh();

    button('Tools', 'Terminal').click();
    button('Tools', 'Object Explorer').click();
    button('Tools', 'Reset Layout').click();

    expect(handler.calls).toEqual(['togglePanel:terminal', 'togglePanel:objects', 'resetLayout']);
  });

  it('save_whenPressed_savesInPlace', () => {
    button('File', 'Save').click();

    expect(handler.calls).toEqual(['save']);
  });

  it('saveItems_withNoPassphrase_offerSaveAsAndSetPassphrase', () => {
    expect(saveItems()).toEqual(['Save As', 'Set Passphrase']);
  });

  it('saveItems_withAPassphrase_offerChangeAndRemove', () => {
    handler.hasPassphrase.set(true);
    refresh();

    expect(saveItems()).toEqual(['Save As', 'Change Passphrase', 'Remove Passphrase']);
  });

  it('saveItems_whileLocked_offerUnlock', () => {
    handler.hasPassphrase.set(true);
    handler.locked.set(true);
    refresh();

    expect(saveItems()).toEqual([
      'Save As',
      'Unlock Passwords',
      'Change Passphrase',
      'Remove Passphrase',
    ]);
  });

  it('saveVariant_whenChosen_runsItsCommand', () => {
    internals.onSaveVariant('save-as');
    internals.onSaveVariant('set-passphrase');
    internals.onSaveVariant('unlock-passphrase');
    internals.onSaveVariant('remove-passphrase');
    internals.onSaveVariant('something-else');

    expect(handler.calls).toEqual([
      'saveAs',
      'setPassphrase',
      'unlockPassphrase',
      'removePassphrase',
      'save',
    ]);
  });

  it('fileMenu_withNoPassphrase_offersSaveSaveAsAndSetPassphrase', () => {
    const ids: readonly (string | undefined)[] = section('file')
      .filter((candidate: MenuEntry): boolean => candidate.kind !== 'separator')
      .map((candidate: MenuEntry): string | undefined => candidate.id);

    expect(ids).toEqual(['database.save', 'database.saveAs', 'database.setPassphrase']);
    expect(entry('file', 'database.saveAs').accelerator).toBe('CmdOrCtrl+Shift+S');
    expect(entry('file', 'database.setPassphrase').label).toBe('Set Passphrase');
  });

  it('fileMenu_whileLockedWithAPassphrase_offersUnlockChangeAndRemove', () => {
    handler.hasPassphrase.set(true);
    handler.locked.set(true);
    refresh();

    const ids: readonly (string | undefined)[] = section('file')
      .filter((candidate: MenuEntry): boolean => candidate.kind !== 'separator')
      .map((candidate: MenuEntry): string | undefined => candidate.id);

    expect(ids).toEqual([
      'database.save',
      'database.saveAs',
      'database.unlockPassphrase',
      'database.setPassphrase',
      'database.removePassphrase',
    ]);
    expect(entry('file', 'database.setPassphrase').label).toBe('Change Passphrase');
  });

  it('fileMenu_whenChosen_runsTheSameHandlersAsTheRibbon', () => {
    handler.hasPassphrase.set(true);
    handler.locked.set(true);
    refresh();

    menu.dispatch('database.save');
    menu.dispatch('database.saveAs');
    menu.dispatch('database.unlockPassphrase');
    menu.dispatch('database.setPassphrase');
    menu.dispatch('database.removePassphrase');

    expect(handler.calls).toEqual([
      'save',
      'saveAs',
      'unlockPassphrase',
      'setPassphrase',
      'removePassphrase',
    ]);
  });

  it('databaseMenu_withNoTarget_disablesTheConnectionItems', () => {
    expect(entry('database', 'database.newConnection').enabled).toBeUndefined();
    expect(entry('database', 'database.toggleConnection').label).toBe('Connect');
    expect(entry('database', 'database.toggleConnection').enabled).toBe(false);
    expect(entry('database', 'database.refreshConnection').enabled).toBe(false);
    expect(entry('database', 'database.editConnection').enabled).toBe(false);
  });

  it('databaseMenu_withAClosedTarget_offersConnectAndEdit', () => {
    handler.connectionTarget.set({ id: 'c1', name: 'Production', state: 'closed' });
    refresh();

    expect(entry('database', 'database.toggleConnection').label).toBe('Connect');
    expect(entry('database', 'database.toggleConnection').enabled).toBe(true);
    expect(entry('database', 'database.refreshConnection').enabled).toBe(false);
    expect(entry('database', 'database.editConnection').enabled).toBe(true);
  });

  it('databaseMenu_whileConnecting_disablesConnect', () => {
    handler.connectionTarget.set({ id: 'c1', name: 'Production', state: 'connecting' });
    refresh();

    expect(entry('database', 'database.toggleConnection').enabled).toBe(false);
    expect(entry('database', 'database.editConnection').enabled).toBe(true);
  });

  it('databaseMenu_withAnOpenTarget_offersDisconnectAndRefresh', () => {
    handler.connectionTarget.set({ id: 'c1', name: 'Production', state: 'open' });
    refresh();

    expect(entry('database', 'database.toggleConnection').label).toBe('Disconnect');
    expect(entry('database', 'database.toggleConnection').enabled).toBe(true);
    expect(entry('database', 'database.refreshConnection').enabled).toBe(true);
  });

  it('databaseMenu_execute_followsTheRibbonsExecute', () => {
    expect(entry('database', 'database.execute').enabled).toBe(false);
    expect(entry('database', 'database.execute').label).toBe('Execute Query');

    handler.canExecute.set(true);
    handler.executing.set(true);
    refresh();

    expect(entry('database', 'database.execute').enabled).toBe(true);
    expect(entry('database', 'database.execute').label).toBe('Cancel Query');
  });

  it('databaseMenu_whenChosen_runsTheSameHandlersAsTheRibbon', () => {
    handler.connectionTarget.set({ id: 'c1', name: 'Production', state: 'open' });
    refresh();

    menu.dispatch('database.newConnection');
    menu.dispatch('database.toggleConnection');
    menu.dispatch('database.refreshConnection');
    menu.dispatch('database.editConnection');
    menu.dispatch('database.newQuery');
    menu.dispatch('database.execute');

    expect(handler.calls).toEqual([
      'newConnection',
      'toggleConnection',
      'refreshConnection',
      'editConnection',
      'newQuery',
      'execute',
    ]);
  });

  it('viewMenu_offersACheckboxPerPanel_checkedWhileItShows', () => {
    handler.panels.set(PANELS);
    refresh();

    const objects: MenuEntry = entry('view', 'database.panel.objects');
    const terminal: MenuEntry = entry('view', 'database.panel.terminal');
    expect(objects).toMatchObject({ label: 'Object Explorer', kind: 'checkbox', checked: true });
    expect(terminal).toMatchObject({ label: 'Terminal', kind: 'checkbox', checked: false });
    expect(entry('view', 'database.resetLayout').label).toBe('Reset Layout');
  });

  it('viewMenu_whenChosen_togglesThePanelOrResetsTheLayout', () => {
    handler.panels.set(PANELS);
    refresh();

    menu.dispatch('database.panel.terminal');
    menu.dispatch('database.resetLayout');

    expect(handler.calls).toEqual(['togglePanel:terminal', 'resetLayout']);
  });

  it('menu_whenTheRibbonIsDestroyed_isWithdrawn', () => {
    fixture.destroy();
    TestBed.tick();

    expect(
      section('database').some((candidate: MenuEntry): boolean =>
        (candidate.id ?? '').startsWith('database.'),
      ),
    ).toBe(false);
  });
});
