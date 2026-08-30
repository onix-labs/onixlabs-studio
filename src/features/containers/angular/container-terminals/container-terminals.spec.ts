import { describe, expect, it, Mock, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import { TerminalCreateOptions } from '@shared/api/terminal-channels';
import { ContainerTerminal, ContainerTerminals } from './container-terminals';

/**
 * A stub terminal bridge recording the create/dispose calls the service makes.
 */
function stubBridge(): { create: Mock; dispose: Mock } {
  const create: Mock = vi.fn((): Promise<{ success: boolean }> =>
    Promise.resolve({ success: true }),
  );
  const dispose: Mock = vi.fn((): Promise<boolean> => Promise.resolve(true));
  TestBed.configureTestingModule({
    providers: [ContainerTerminals, { provide: TerminalBridge, useValue: { create, dispose } }],
  });
  return { create, dispose };
}

describe('ContainerTerminals', () => {
  it('open_spawnsARunTerminalForTheCommandAndMakesItActive', () => {
    const { create } = stubBridge();
    const terminals: ContainerTerminals = TestBed.inject(ContainerTerminals);

    terminals.open('Logs: web', 'docker logs -f abc');

    const sessions: readonly ContainerTerminal[] = terminals.sessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].name).toBe('Logs: web');
    expect(terminals.activeId()).toBe(sessions[0].id);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining<Partial<TerminalCreateOptions>>({
        id: sessions[0].id,
        kind: 'run',
        command: 'docker logs -f abc',
      }),
    );
  });

  it('close_disposesThePtyAndActivatesANeighbour', () => {
    const { dispose } = stubBridge();
    const terminals: ContainerTerminals = TestBed.inject(ContainerTerminals);

    terminals.open('one', 'docker logs -f a');
    terminals.open('two', 'docker logs -f b');
    const first: string = terminals.sessions()[0].id;
    const second: string = terminals.sessions()[1].id;

    terminals.close(second);

    expect(dispose).toHaveBeenCalledWith(second);
    expect(terminals.sessions().map((session: ContainerTerminal): string => session.id)).toEqual([
      first,
    ]);
    expect(terminals.activeId()).toBe(first);
  });

  it('activate_switchesTheActiveSession', () => {
    stubBridge();
    const terminals: ContainerTerminals = TestBed.inject(ContainerTerminals);

    terminals.open('one', 'a');
    terminals.open('two', 'b');
    const first: string = terminals.sessions()[0].id;

    terminals.activate(first);

    expect(terminals.activeId()).toBe(first);
  });
});
