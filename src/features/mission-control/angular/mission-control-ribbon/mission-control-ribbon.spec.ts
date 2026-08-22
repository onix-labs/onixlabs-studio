import { Signal, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { AiPermissionPosture, AiRemoteControlPosture } from '@shared/api/ai-types';
import type { Agent } from '@shared/angular/services/agent/agent';
import { AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import { RibbonAlignment, Settings } from '@shared/angular/services/settings/settings';
import { MissionControl } from '@features/mission-control/angular/mission-control/mission-control';
import { MissionControlRibbon } from './mission-control-ribbon';

/**
 * The ribbon internals the tests reach into (protected on the component).
 */
interface RibbonInternals {
  readonly runningCount: Signal<number>;
  readonly remoteCapableCount: Signal<number>;
  readonly allRemoteControlled: Signal<boolean>;
  readonly remoteConfirmOpen: Signal<boolean>;
  readonly permissionPosture: Signal<AiPermissionPosture>;
  onStopAll(): void;
  onRemoteToggle(): void;
  onRemoteConfirmed(): void;
  onRemoteDismissed(): void;
  onResetLayout(): void;
  onToggleHideEmpty(): void;
  onToggleHideIdle(): void;
  onPosture(posture: AiPermissionPosture): void;
}

describe('MissionControlRibbon', () => {
  let fixture: ComponentFixture<MissionControlRibbon>;
  let host: HTMLElement;
  let ribbon: RibbonInternals;
  let runningCount: WritableSignal<number>;
  let hideEmpty: WritableSignal<boolean>;
  let hideIdle: WritableSignal<boolean>;
  let hideWorking: WritableSignal<boolean>;
  let remoteCapable: WritableSignal<readonly AgentHost[]>;
  let allRemote: WritableSignal<boolean>;
  let posture: WritableSignal<AiPermissionPosture>;
  let calls: string[];

  beforeEach(() => {
    runningCount = signal<number>(0);
    hideEmpty = signal<boolean>(false);
    hideIdle = signal<boolean>(false);
    hideWorking = signal<boolean>(false);
    remoteCapable = signal<readonly AgentHost[]>([]);
    allRemote = signal<boolean>(false);
    posture = signal<AiPermissionPosture>('prompt');
    calls = [];

    const missionControlStub: Partial<MissionControl> = {
      hideEmpty: hideEmpty.asReadonly(),
      hideIdle: hideIdle.asReadonly(),
      hideWorking: hideWorking.asReadonly(),
      resetWidths: (): void => void calls.push('resetWidths'),
      setHideEmpty: (value: boolean): void => {
        calls.push(`setHideEmpty:${value}`);
        hideEmpty.set(value);
      },
      setHideIdle: (value: boolean): void => {
        calls.push(`setHideIdle:${value}`);
        hideIdle.set(value);
      },
      setHideWorking: (value: boolean): void => {
        calls.push(`setHideWorking:${value}`);
        hideWorking.set(value);
      },
    };
    const agentHostsStub: Partial<AgentHosts> = {
      runningCount: runningCount.asReadonly(),
      remoteCapableHosts: remoteCapable.asReadonly(),
      allRemoteControlled: allRemote.asReadonly(),
      stopAll: (): void => void calls.push('stopAll'),
      setRemoteControlAll: (enabled: boolean): void => {
        calls.push(`setRemoteControlAll:${enabled}`);
        allRemote.set(enabled);
      },
    };
    const settingsStub: Partial<Settings> = {
      aiPermissionPosture: posture.asReadonly(),
      aiRemoteControlPosture: signal<AiRemoteControlPosture>('control').asReadonly(),
      ribbonAlignment: signal<RibbonAlignment>('left').asReadonly(),
      setAiPermissionPosture: (value: AiPermissionPosture): void => {
        calls.push(`setPosture:${value}`);
        posture.set(value);
      },
    };

    TestBed.configureTestingModule({
      imports: [MissionControlRibbon],
      providers: [
        { provide: MissionControl, useValue: missionControlStub },
        { provide: AgentHosts, useValue: agentHostsStub },
        { provide: Settings, useValue: settingsStub },
      ],
    });
    fixture = TestBed.createComponent(MissionControlRibbon);
    host = fixture.nativeElement as HTMLElement;
    ribbon = fixture.componentInstance as unknown as RibbonInternals;
  });

  /**
   * Finds a rendered ribbon button by its label.
   * @param label The button's label.
   * @returns Returns the button element.
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

  it('render_drawsStopAll_resetWidths_theThreeStateToggles_threePostures_andTheRemoteToggle', () => {
    fixture.detectChanges();

    expect(button('Stop All')).toBeTruthy();
    expect(button('Remote Control')).toBeTruthy();
    expect(button('Reset Widths')).toBeTruthy();
    expect(button('Hide Empty')).toBeTruthy();
    expect(button('Hide Idle')).toBeTruthy();
    expect(button('Hide Working')).toBeTruthy();
    expect(button('Prompt All')).toBeTruthy();
    expect(button('Allow Edits')).toBeTruthy();
    expect(button('Allow All')).toBeTruthy();
    // The bulk Remote toggle has nothing to expose until an agent registers.
    expect(button('Remote Control').disabled).toBe(true);
  });

  it('viewToggles_areTheThreeRunStates_andResetWidthsIsNotOneOfThem', () => {
    // Reset Widths leads the group as a command, so it must not have picked up toggle semantics: only
    // the three run-state filters latch, and each reports its own pressed state.
    fixture.detectChanges();

    expect(button('Reset Widths').getAttribute('aria-pressed')).toBeNull();
    for (const label of ['Hide Empty', 'Hide Idle', 'Hide Working']) {
      expect(button(label).getAttribute('aria-pressed')).toBe('false');
    }

    button('Hide Working').click();
    fixture.detectChanges();

    expect(calls).toEqual(['setHideWorking:true']);
    expect(button('Hide Working').getAttribute('aria-pressed')).toBe('true');
    expect(button('Hide Idle').getAttribute('aria-pressed')).toBe('false');
  });

  it('postureButtons_pressExactlyTheOneInForce', () => {
    fixture.detectChanges();
    expect(button('Prompt All').getAttribute('aria-pressed')).toBe('true');
    expect(button('Allow All').getAttribute('aria-pressed')).toBe('false');

    button('Allow All').click();
    fixture.detectChanges();

    expect(calls).toEqual(['setPosture:auto-all']);
    expect(button('Prompt All').getAttribute('aria-pressed')).toBe('false');
    expect(button('Allow All').getAttribute('aria-pressed')).toBe('true');
  });

  it('runningCount_reflectsTheLiveHostRegistry', () => {
    expect(ribbon.runningCount()).toBe(0);
    runningCount.set(3);
    expect(ribbon.runningCount()).toBe(3);
  });

  it('remoteCapableCount_countsTheHostsABulkToggleWouldActOn', () => {
    expect(ribbon.remoteCapableCount()).toBe(0);

    remoteCapable.set([{ agent: {} as Agent } as AgentHost, { agent: {} as Agent } as AgentHost]);

    expect(ribbon.remoteCapableCount()).toBe(2);
  });

  it('onStopAll_stopsEveryRunningHost', () => {
    ribbon.onStopAll();
    expect(calls).toEqual(['stopAll']);
  });

  it('onRemoteToggle_opensTheConfirmation_withoutFlippingAnything', () => {
    ribbon.onRemoteToggle();

    expect(ribbon.remoteConfirmOpen()).toBe(true);
    expect(calls).toEqual([]);
  });

  it('onRemoteConfirmed_exposesEveryRemoteCapableHost_andClosesTheConfirmation', () => {
    ribbon.onRemoteToggle();
    ribbon.onRemoteConfirmed();

    expect(calls).toEqual(['setRemoteControlAll:true']);
    expect(ribbon.remoteConfirmOpen()).toBe(false);
  });

  it('onRemoteConfirmed_whenAllAreExposed_stopsExposingThem', () => {
    allRemote.set(true);

    ribbon.onRemoteToggle();
    ribbon.onRemoteConfirmed();

    expect(calls).toEqual(['setRemoteControlAll:false']);
  });

  it('onRemoteDismissed_closesTheConfirmation_andChangesNothing', () => {
    ribbon.onRemoteToggle();
    ribbon.onRemoteDismissed();

    expect(ribbon.remoteConfirmOpen()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('onResetLayout_resetsTheTileWidths', () => {
    ribbon.onResetLayout();
    expect(calls).toEqual(['resetWidths']);
  });

  it('onToggleHideEmpty_flipsTheHideEmptyPreference', () => {
    ribbon.onToggleHideEmpty();
    expect(calls).toEqual(['setHideEmpty:true']);

    ribbon.onToggleHideEmpty();
    expect(calls).toEqual(['setHideEmpty:true', 'setHideEmpty:false']);
  });

  it('onToggleHideIdle_flipsTheHideIdlePreference', () => {
    ribbon.onToggleHideIdle();
    expect(calls).toEqual(['setHideIdle:true']);
  });

  it('onPosture_movesThePosture_andIgnoresTheOneAlreadyInForce', () => {
    ribbon.onPosture('auto-all');
    expect(calls).toEqual(['setPosture:auto-all']);
    expect(ribbon.permissionPosture()).toBe('auto-all');

    // The three buttons are radios, not switches: pressing the pressed one must not un-set it.
    ribbon.onPosture('auto-all');
    expect(calls).toEqual(['setPosture:auto-all']);
    expect(ribbon.permissionPosture()).toBe('auto-all');
  });
});
