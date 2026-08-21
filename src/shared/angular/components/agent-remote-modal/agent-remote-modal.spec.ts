import { Signal, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { AiRemoteControlPosture } from '@shared/api/ai-types';
import { Settings } from '@shared/angular/services/settings/settings';
import { AgentRemoteModal } from './agent-remote-modal';

/**
 * The dialog's internals the tests read (protected on the component).
 */
interface ModalInternals {
  readonly title: Signal<string>;
  readonly body: Signal<string>;
  readonly hint: Signal<string>;
}

describe('AgentRemoteModal', () => {
  let fixture: ComponentFixture<AgentRemoteModal>;
  let component: AgentRemoteModal;
  let internals: ModalInternals;
  let posture: WritableSignal<AiRemoteControlPosture>;

  beforeEach(async () => {
    posture = signal<AiRemoteControlPosture>('control');
    const settingsStub: Partial<Settings> = { aiRemoteControlPosture: posture.asReadonly() };

    await TestBed.configureTestingModule({
      imports: [AgentRemoteModal],
      providers: [{ provide: Settings, useValue: settingsStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentRemoteModal);
    component = fixture.componentInstance;
    internals = component as unknown as ModalInternals;
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('enabling', true);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('title_forOneAgent_asksAboutThatAgent', () => {
    expect(internals.title()).toBe('Enable remote control for this agent?');

    fixture.componentRef.setInput('enabling', false);
    expect(internals.title()).toBe('Disable remote control for this agent?');
  });

  it('title_forSeveralAgents_saysHowMany', () => {
    fixture.componentRef.setInput('count', 4);

    expect(internals.title()).toBe('Enable remote control for all 4 agents?');
  });

  it('body_underFullControl_saysAPeerCanDriveTheSession', () => {
    expect(internals.body()).toContain('drive it');
  });

  it('body_underReadOnly_saysAPeerCanOnlyWatch', () => {
    posture.set('mirror');

    expect(internals.body()).toContain('watch it, but not act on it');
  });

  it('body_whenDisabling_doesNotDescribeThePosture', () => {
    fixture.componentRef.setInput('enabling', false);

    expect(internals.body()).toContain('stop being exposed');
    expect(internals.body()).not.toContain('drive it');
  });

  it('hint_whenEnabling_namesThePostureInForce', () => {
    expect(internals.hint()).toContain('Full Control');

    posture.set('mirror');
    expect(internals.hint()).toContain('Read-Only');
  });

  it('hint_whenDisabling_saysOnlyWhenTheChangeLands', () => {
    fixture.componentRef.setInput('enabling', false);

    expect(internals.hint()).toBe('Takes effect on the next message sent.');
  });
});
