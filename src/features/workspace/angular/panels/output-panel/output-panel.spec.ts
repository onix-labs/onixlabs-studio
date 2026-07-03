import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockPanel } from '@shared/angular/services/dock/dock-panel';
import { Icon } from '@shared/angular/icons/icon';

import { OutputPanel } from './output-panel';

describe('OutputPanel', () => {
  let component: OutputPanel;
  let fixture: ComponentFixture<OutputPanel>;

  const panel: DockPanel = {
    id: 'output',
    title: 'Output',
    icon: Icon.OUTPUT,
    role: 'tool',
    component: OutputPanel,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OutputPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(OutputPanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panel', panel);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenOutsideElectron_showsTheUnavailableMessage', () => {
    fixture.detectChanges();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('only available when running inside Electron');
  });
});
