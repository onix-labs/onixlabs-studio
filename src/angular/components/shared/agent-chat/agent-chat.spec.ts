import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentChat } from './agent-chat';

describe('AgentChat', () => {
  let component: AgentChat;
  let fixture: ComponentFixture<AgentChat>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentChat],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentChat);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenFresh_showsTheWelcomeMessage', () => {
    fixture.detectChanges();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('I am your workspace agent');
  });

  it('send_whenDraftEntered_appendsMessagesAndClearsTheDraft', () => {
    component.onInput('what can you do?');
    component.send();
    fixture.detectChanges();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('what can you do?');
    expect(component.draft()).toBe('');
  });
});
