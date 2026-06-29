import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Terminal } from './terminal';

describe('Terminal', () => {
  let fixture: ComponentFixture<Terminal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Terminal],
    }).compileComponents();

    fixture = TestBed.createComponent(Terminal);
    fixture.componentRef.setInput('terminalId', 'tab-1');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_whenOutsideElectron_showsTheUnavailableMessage', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.terminal')?.textContent).toContain('only available');
  });
});
