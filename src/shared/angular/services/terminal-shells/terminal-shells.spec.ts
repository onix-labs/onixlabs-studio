import { TestBed } from '@angular/core/testing';

import { ShellInfo } from '@shared/api/terminal-channels';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import { TerminalShells } from './terminal-shells';

describe('TerminalShells', () => {
  /**
   * Configures the testing module with a terminal bridge whose shell list is stubbed.
   * @param shells The shells the stubbed bridge reports.
   * @returns Returns the resolved {@link TerminalShells} instance.
   */
  async function setup(shells: readonly ShellInfo[]): Promise<TerminalShells> {
    TestBed.configureTestingModule({
      providers: [{ provide: TerminalBridge, useValue: { listShells: (): Promise<readonly ShellInfo[]> => Promise.resolve(shells) } }],
    });
    const service: TerminalShells = TestBed.inject(TerminalShells);
    await Promise.resolve();
    return service;
  }

  it('loadsTheInstalledShellsFromTheBridge', async () => {
    const shells: readonly ShellInfo[] = [{ name: 'zsh', path: '/bin/zsh' }];
    const service: TerminalShells = await setup(shells);
    expect(service.shells()).toEqual(shells);
  });

  it('nameOf_whenPathIsKnown_returnsTheEnumeratedName', async () => {
    const service: TerminalShells = await setup([{ name: 'zsh', path: '/bin/zsh' }]);
    expect(service.nameOf('/bin/zsh')).toBe('zsh');
  });

  it('nameOf_whenPathIsUnknown_fallsBackToTheBaseName', async () => {
    const service: TerminalShells = await setup([]);
    expect(service.nameOf('/opt/homebrew/bin/fish')).toBe('fish');
    expect(service.nameOf('C:\\Windows\\System32\\cmd.exe')).toBe('cmd');
  });
});
