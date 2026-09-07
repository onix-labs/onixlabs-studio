import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ShellInfo } from '@shared/api/terminal-channels';
import { TerminalShells } from '@shared/angular/services/terminal-shells/terminal-shells';
import { ShellPicker } from './shell-picker';

describe('ShellPicker', () => {
  let fixture: ComponentFixture<ShellPicker>;
  let host: HTMLElement;

  const SHELLS: readonly ShellInfo[] = [
    { name: 'zsh', path: '/bin/zsh' },
    { name: 'bash', path: '/bin/bash' },
  ];

  /**
   * Builds the picker with the given deferring label and selection.
   * @param defaultLabel The label of the leading entry.
   * @param value The selected shell path.
   * @returns Returns a promise that resolves once the view has settled.
   */
  async function render(defaultLabel: string, value: string = ''): Promise<void> {
    fixture = TestBed.createComponent(ShellPicker);
    fixture.componentRef.setInput('defaultLabel', defaultLabel);
    fixture.componentRef.setInput('value', value);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /**
   * Reads the rendered option labels.
   * @returns Returns the labels in order.
   */
  function labels(): readonly string[] {
    return Array.from(host.querySelectorAll('option')).map(
      (option: HTMLOptionElement): string => option.textContent?.trim() ?? '',
    );
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ShellPicker],
      providers: [
        { provide: TerminalShells, useValue: { shells: (): readonly ShellInfo[] => SHELLS } },
      ],
    }).compileComponents();
  });

  it('options_always_leadWithTheDeferringEntryThenEachInstalledShell', async () => {
    await render('System default');

    expect(labels()).toEqual(['System default', 'zsh', 'bash']);
  });

  it('options_whenTheCallerNamesTheDefaultDifferently_usesThatLabel', async () => {
    // The only thing that differs between the surfaces offering this choice: what the host resolves
    // the empty value to is a terminal's shell in one case and an agent's environment in another.
    await render('Default login shell');

    expect(labels()[0]).toBe('Default login shell');
  });

  it('options_whenNoShellsAreInstalled_stillOffersTheDefault', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ShellPicker],
      providers: [
        { provide: TerminalShells, useValue: { shells: (): readonly ShellInfo[] => [] } },
      ],
    }).compileComponents();

    await render('System default');

    expect(labels()).toEqual(['System default']);
  });

  it('value_whenAShellIsSelected_isReflectedInTheControl', async () => {
    await render('System default', '/bin/bash');

    expect(host.querySelector('select')?.value).toBe('/bin/bash');
  });

  it('valueChange_whenAShellIsChosen_emitsItsPath', async () => {
    await render('System default');
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((value: string): void => {
      emitted.push(value);
    });
    const select: HTMLSelectElement | null = host.querySelector('select');
    if (select === null) {
      throw new Error('No shell select rendered');
    }

    select.value = '/bin/zsh';
    select.dispatchEvent(new Event('change'));

    expect(emitted).toEqual(['/bin/zsh']);
  });

  it('valueChange_whenTheDefaultIsChosen_emitsTheEmptyString', async () => {
    await render('System default', '/bin/zsh');
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((value: string): void => {
      emitted.push(value);
    });
    const select: HTMLSelectElement | null = host.querySelector('select');
    if (select === null) {
      throw new Error('No shell select rendered');
    }

    select.value = '';
    select.dispatchEvent(new Event('change'));

    expect(emitted).toEqual(['']);
  });
});
