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

  it('beforeTheFetchResolves_reportsAnEmptyList', () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: TerminalBridge,
          useValue: {
            listShells: (): Promise<readonly ShellInfo[]> =>
              new Promise((): undefined => undefined),
          },
        },
      ],
    });
    expect(TestBed.inject(TerminalShells).shells()).toEqual([]);
  });
});
