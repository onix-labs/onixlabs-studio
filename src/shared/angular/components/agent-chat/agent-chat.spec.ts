import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { AgentContextRef } from '@shared/api/ai-types';
import { Agent, AgentItem } from '@shared/angular/services/agent/agent';
import { AgentChat } from './agent-chat';

describe('AgentChat', () => {
  let component: AgentChat;
  let fixture: ComponentFixture<AgentChat>;
  let sent: string[];
  let stopped: number;
  let contextPaths: WritableSignal<readonly AgentContextRef[]>;
  let removed: string[];

  beforeEach(async () => {
    sent = [];
    stopped = 0;
    contextPaths = signal<readonly AgentContextRef[]>([]);
    removed = [];
    const agentStub: Partial<Agent> = {
      items: signal<readonly AgentItem[]>([]),
      isRunning: signal<boolean>(false),
      awaitingDecision: signal<boolean>(false),
      contextPaths,
      send: (text: string): void => void sent.push(text),
      stop: (): void => void (stopped += 1),
      removeContext: (path: string): void => void removed.push(path),
      respondPermission: (): void => undefined,
    };

    await TestBed.configureTestingModule({
      imports: [AgentChat],
    })
      .overrideComponent(AgentChat, {
        set: { providers: [{ provide: Agent, useValue: agentStub }] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AgentChat);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('send_whenDraftEntered_sendsToTheAgentAndClearsTheDraft', () => {
    component.onInput('what can you do?');
    component.send();

    expect(sent).toEqual(['what can you do?']);
    expect(component.draft()).toBe('');
  });

  it('send_whenDraftBlank_doesNothing', () => {
    component.onInput('   ');
    component.send();

    expect(sent).toHaveLength(0);
  });

  it('stop_whenCalled_stopsTheAgent', () => {
    component.stop();

    expect(stopped).toBe(1);
  });

  it('onKeydown_whenEnterWithoutShift_sends', () => {
    component.onInput('hi');
    component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(sent).toEqual(['hi']);
  });

  it('onKeydown_whenShiftEnter_doesNotSend', () => {
    component.onInput('hi');
    component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));

    expect(sent).toHaveLength(0);
  });

  it('attachments_whenContextAttached_rendersAChipWithItsBasename', () => {
    contextPaths.set([{ path: '/repo/src/main.ts', kind: 'file' }]);
    fixture.detectChanges();

    const chip: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.agent__attachment-name',
    );
    expect(chip?.textContent?.trim()).toBe('main.ts');
  });

  it('removeContext_whenChipRemoveClicked_detachesThePath', () => {
    contextPaths.set([{ path: '/repo/src/main.ts', kind: 'file' }]);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.agent__attachment-remove')!
      .click();

    expect(removed).toEqual(['/repo/src/main.ts']);
  });

  it('composer_whenRendered_doesNotShowProviderOrModelDropdowns', () => {
    fixture.detectChanges();
    const dropdowns: NodeListOf<Element> = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.agent__composer app-dropdown',
    );

    expect(dropdowns.length).toBe(0);
  });
});
