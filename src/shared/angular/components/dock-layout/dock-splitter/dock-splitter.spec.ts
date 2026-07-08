import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockSplitter } from './dock-splitter';

describe('DockSplitter', () => {
  let component: DockSplitter;
  let fixture: ComponentFixture<DockSplitter>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DockSplitter],
    }).compileComponents();

    fixture = TestBed.createComponent(DockSplitter);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('splitId', 'split-1');
    fixture.componentRef.setInput('index', 0);
    fixture.componentRef.setInput('dir', 'row');
    fixture.componentRef.setInput('sizes', [1, 1]);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenRowDirection_carriesTheRowModifierClass', () => {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(host.classList.contains('dock-splitter--row')).toBe(true);
    expect(host.classList.contains('dock-splitter--col')).toBe(false);
  });

  it('press_whenHandleHasNoSiblingPanes_doesNotThrow', () => {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    expect((): void => {
      host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }).not.toThrow();
  });
});
