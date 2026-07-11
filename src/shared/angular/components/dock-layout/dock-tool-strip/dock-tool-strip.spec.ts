import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockTool, DockToolStrip } from './dock-tool-strip';

describe('DockToolStrip', () => {
  let component: DockToolStrip;
  let fixture: ComponentFixture<DockToolStrip>;
  let host: HTMLElement;

  /**
   * Reads the aria-labels of every rendered tool button, in order.
   * @returns Returns the rendered labels.
   */
  function labels(): readonly (string | null)[] {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('.dock-tool-strip__tool')).map(
      (button: HTMLButtonElement): string | null => button.getAttribute('aria-label'),
    );
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DockToolStrip],
    }).compileComponents();

    fixture = TestBed.createComponent(DockToolStrip);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('render_whenNoToolsSupplied_rendersTheDefaultStubbedSet', () => {
    fixture.detectChanges();

    expect(labels()).toEqual(['Filter', 'Collapse All', 'Refresh', 'More Actions']);
  });

  it('render_whenToolsSupplied_rendersOnlyTheSuppliedSet', () => {
    const tools: readonly DockTool[] = [
      { id: 'run', icon: Icon.SEARCH, label: 'Run' },
      { id: 'stop', icon: Icon.LIST, label: 'Stop' },
    ];
    fixture.componentRef.setInput('tools', tools);
    fixture.detectChanges();

    expect(labels()).toEqual(['Run', 'Stop']);
  });

  it('render_setsTheTooltipFromEachToolLabel', () => {
    const tools: readonly DockTool[] = [{ id: 'run', icon: Icon.SEARCH, label: 'Run' }];
    fixture.componentRef.setInput('tools', tools);
    fixture.detectChanges();

    const button: HTMLButtonElement | null =
      host.querySelector<HTMLButtonElement>('.dock-tool-strip__tool');
    expect(button?.title).toBe('Run');
    expect(button?.querySelector('app-icon')).not.toBeNull();
  });
});
