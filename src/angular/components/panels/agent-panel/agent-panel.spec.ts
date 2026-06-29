import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockPanel } from '../../../services/dock/dock-panel';
import { Icon } from '@shared/angular/icons/icon';

import { AgentPanel } from './agent-panel';

describe('AgentPanel', () => {
  let component: AgentPanel;
  let fixture: ComponentFixture<AgentPanel>;

  const panel: DockPanel = {
    id: 'agent',
    title: 'Agent',
    icon: Icon.AGENT,
    role: 'tool',
    component: AgentPanel,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentPanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panel', panel);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_embedsTheChatShell', () => {
    fixture.detectChanges();
    const composer: Element | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.agent__composer',
    );
    expect(composer).not.toBeNull();
  });
});
