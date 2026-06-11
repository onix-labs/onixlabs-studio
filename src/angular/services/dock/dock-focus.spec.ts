import { TestBed } from '@angular/core/testing';
import { DockFocus } from './dock-focus';

describe('DockFocus', () => {
  let focus: DockFocus;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    focus = TestBed.inject(DockFocus);
  });

  it('focusedStackId_whenIdle_isNull', () => {
    expect(focus.focusedStackId()).toBeNull();
  });

  it('focus_whenCalled_setsTheFocusedStack', () => {
    focus.focus('stack-1');

    expect(focus.focusedStackId()).toBe('stack-1');
  });

  it('focus_whenCalledAgain_movesFocus', () => {
    focus.focus('stack-1');
    focus.focus('stack-2');

    expect(focus.focusedStackId()).toBe('stack-2');
  });
});
