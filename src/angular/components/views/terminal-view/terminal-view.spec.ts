import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TerminalView } from './terminal-view';

describe('TerminalView', () => {
  let component: TerminalView;
  let fixture: ComponentFixture<TerminalView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TerminalView],
    }).compileComponents();

    fixture = TestBed.createComponent(TerminalView);
    fixture.componentRef.setInput('terminalId', 'tab-1');
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenOutsideElectron_showsTheUnavailableMessage', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.terminal')?.textContent).toContain('only available');
  });
});
