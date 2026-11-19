import { ApplicationRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AiConnection } from '@shared/api/ai-types';
import type { Bridge } from '@shared/api/bridge';
import { PeteChannel, type PersonaRebuildEstimate } from '@shared/api/pete-protocol';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { Settings } from '@shared/angular/services/settings/settings';
import { PersonaRebuild } from './persona-rebuild';

describe('PersonaRebuild (#1518)', () => {
  let fixture: ComponentFixture<PersonaRebuild>;
  let windows: FakeModalWindows;
  let calls: [string, unknown][];
  let estimate: PersonaRebuildEstimate;
  let closed: number;

  beforeEach(async () => {
    localStorage.clear();
    calls = [];
    closed = 0;
    estimate = { conversations: 12, characters: 34_000, tokens: 12_345, batches: 2 };
    const bridge: Partial<Bridge> = {
      invoke: <T>(channel: string, arg?: unknown): Promise<T> => {
        calls.push([channel, arg]);
        if (channel === (PeteChannel.EstimateRebuild as string)) {
          return Promise.resolve(estimate as T);
        }
        if (channel === (PeteChannel.State as string)) {
          return Promise.resolve({
            recent: [],
            pending: [],
            ruledOut: [],
            questions: [],
            lastRun: 0,
            rebuild: null,
          } as T);
        }
        return Promise.resolve(null as T);
      },
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge?: Partial<Bridge> }).bridge = bridge;
    windows = new FakeModalWindows();
    TestBed.configureTestingModule({ providers: [{ provide: ModalWindows, useValue: windows }] });
    const settings: Settings = TestBed.inject(Settings);
    const local: AiConnection = { id: 'local', kind: 'ollama', label: 'Ollama' } as AiConnection;
    const paid: AiConnection = { id: 'claude', kind: 'anthropic', label: 'Claude' } as AiConnection;
    settings.set('ai.connections', [local, paid]);
    settings.set('persona.peteConnectionId', 'local');
    fixture = TestBed.createComponent(PersonaRebuild);
    fixture.componentInstance.closed.subscribe((): number => (closed += 1));
    fixture.componentRef.setInput('open', true);
    await settle();
  });

  afterEach(() => {
    fixture.destroy();
    delete (window as unknown as { bridge?: Bridge }).bridge;
  });

  /**
   * Lets the dialog render into its window.
   * @returns Resolves once rendered.
   */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    TestBed.inject(ApplicationRef).tick();
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();
  }

  /**
   * Gets the dialog's content.
   * @returns Returns it.
   */
  function host(): HTMLElement {
    return windows.contentHost ?? document.createElement('div');
  }

  /**
   * Finds a button by its text.
   * @param label The text.
   * @returns Returns the button.
   */
  function button(label: string): HTMLButtonElement | undefined {
    return [...host().querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate: HTMLButtonElement): boolean => candidate.textContent?.trim() === label,
    );
  }

  it('saysHowMuchItWouldRead_beforeAnythingIsSent', () => {
    expect(host().querySelector('[data-testid="rebuild-estimate"]')?.textContent).toContain(
      '12 conversations, about 34k characters you typed. Pete reads them in 2 batches, sending the model about 12k tokens.',
    );
    expect(host().textContent).toContain('nothing is sent anywhere, and it costs nothing');
    expect(
      calls.some(([channel]): boolean => channel === (PeteChannel.StartRebuild as string)),
    ).toBe(false);
  });

  it('withAPaidModel_saysOnlyWhatYouTypedIsSent', async () => {
    // Pete's own connection is what the dialog starts on; reopen it with a paid one chosen.
    fixture.componentRef.setInput('open', false);
    TestBed.inject(Settings).set('persona.peteConnectionId', 'claude');
    fixture.componentRef.setInput('open', true);
    await settle();

    expect(host().textContent).toContain('A paid model charges for these tokens');
  });

  it('startFresh_explainsWhatStays_andStartsWithTheChoices', async () => {
    button('Start fresh')?.click();
    await settle();

    expect(host().querySelector('[data-testid="rebuild-mode-text"]')?.textContent).toContain(
      'Locked entries and anything you wrote stay',
    );

    button('Start')?.click();
    await settle();

    expect(calls).toContainEqual([
      PeteChannel.StartRebuild,
      { mode: 'fresh', connectionId: 'local', model: '' },
    ]);
    expect(closed).toBe(1);
  });
});
