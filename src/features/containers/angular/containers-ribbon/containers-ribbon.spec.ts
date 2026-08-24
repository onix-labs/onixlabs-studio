import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { ContainersCommands } from '@features/containers/angular/containers-commands/containers-commands';
import { ContainersRibbon } from './containers-ribbon';

describe('ContainersRibbon', () => {
  let component: ContainersRibbon;
  let fixture: ComponentFixture<ContainersRibbon>;
  let host: HTMLElement;
  let menu: AppMenu;
  let calls: string[];
  let hasSelection: WritableSignal<boolean>;
  let selectionRunning: WritableSignal<boolean>;

  /**
   * Finds a ribbon button by its visible label.
   * @param label The button label.
   * @returns Returns the matching button element.
   */
  function button(label: string): HTMLButtonElement {
    const match: HTMLButtonElement | undefined = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button'),
    ).find((element: HTMLButtonElement): boolean => element.textContent?.trim() === label);
    if (match === undefined) {
      throw new Error(`No button labelled "${label}"`);
    }
    return match;
  }

  beforeEach(async () => {
    calls = [];
    hasSelection = signal<boolean>(true);
    selectionRunning = signal<boolean>(true);
    const commandsStub: Partial<ContainersCommands> = {
      hasSelection,
      selectionRunning,
      start: (): void => void calls.push('start'),
      stop: (): void => void calls.push('stop'),
      remove: (): void => void calls.push('remove'),
      viewLogs: (): void => void calls.push('viewLogs'),
      shell: (): void => void calls.push('shell'),
      refresh: (): void => void calls.push('refresh'),
    };

    await TestBed.configureTestingModule({
      imports: [ContainersRibbon],
      providers: [{ provide: ContainersCommands, useValue: commandsStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(ContainersRibbon);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    menu = TestBed.inject(AppMenu);
    fixture.detectChanges();
    await fixture.whenStable();
    TestBed.tick();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('buttons_whenPressed_routeToTheContainerCommands', () => {
    button('Stop').click();
    button('Remove').click();
    button('Logs').click();
    button('Shell').click();
    button('Refresh').click();

    expect(calls).toEqual(['stop', 'remove', 'viewLogs', 'shell', 'refresh']);
  });

  it('start_whenTheSelectionIsAlreadyRunning_isDisabled', () => {
    expect(button('Start').disabled).toBe(true);

    selectionRunning.set(false);
    fixture.detectChanges();

    expect(button('Start').disabled).toBe(false);
    button('Start').click();
    expect(calls).toEqual(['start']);
  });

  it('stop_whenTheSelectionIsNotRunning_isDisabled', () => {
    selectionRunning.set(false);
    fixture.detectChanges();

    expect(button('Stop').disabled).toBe(true);
  });

  it('commands_whenNothingIsSelected_areDisabledExceptRefresh', () => {
    hasSelection.set(false);
    fixture.detectChanges();

    expect(button('Start').disabled).toBe(true);
    expect(button('Stop').disabled).toBe(true);
    expect(button('Remove').disabled).toBe(true);
    expect(button('Logs').disabled).toBe(true);
    expect(button('Shell').disabled).toBe(true);
    // Refreshing the list needs no selection, so it stays available.
    expect(button('Refresh').disabled).toBe(false);
  });

  it('menu_whenACommandIsChosen_runsTheSameHandlerAsTheRibbon', () => {
    menu.dispatch('containers.start');
    menu.dispatch('containers.stop');
    menu.dispatch('containers.remove');
    menu.dispatch('containers.logs');
    menu.dispatch('containers.shell');
    menu.dispatch('containers.refresh');

    expect(calls).toEqual(['start', 'stop', 'remove', 'viewLogs', 'shell', 'refresh']);
  });
});
