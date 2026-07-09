import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ShellInfo } from '@shared/api/terminal-channels';
import { Settings } from '@shared/angular/services/settings/settings';
import { TerminalShells } from '@shared/angular/services/terminal-shells/terminal-shells';
import { TerminalSettingsSection } from './terminal-settings';

describe('TerminalSettingsSection', () => {
  let fixture: ComponentFixture<TerminalSettingsSection>;
  let host: HTMLElement;

  const SHELLS: readonly ShellInfo[] = [
    { name: 'zsh', path: '/bin/zsh' },
    { name: 'bash', path: '/bin/bash' },
  ];

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [TerminalSettingsSection],
      providers: [
        { provide: TerminalShells, useValue: { shells: (): readonly ShellInfo[] => SHELLS } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TerminalSettingsSection);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('render_leadsWithSystemDefaultThenEachInstalledShell', () => {
    const labels: string[] = Array.from(host.querySelectorAll('option')).map(
      (option: HTMLOptionElement): string => option.textContent?.trim() ?? '',
    );
    expect(labels).toEqual(['System default', 'zsh', 'bash']);
  });

  it('defaultShell_defaultsToTheSystemDefault', () => {
    const select: HTMLSelectElement | null = host.querySelector('select');
    expect(select?.value).toBe('');
  });

  it('onChange_whenShellChosen_persistsThePathToSettings', () => {
    const settings: Settings = TestBed.inject(Settings);
    const select: HTMLSelectElement | null = host.querySelector('select');
    if (select === null) {
      throw new Error('No shell select rendered');
    }

    select.value = '/bin/zsh';
    select.dispatchEvent(new Event('change'));

    expect(settings.get('terminal.defaultShell')).toBe('/bin/zsh');
  });
});
