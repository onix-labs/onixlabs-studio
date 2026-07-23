import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Icon } from '@shared/angular/icons/icon';
import { DockAutoHide } from './dock-auto-hide';
import { DockFloating } from './dock-floating';
import { DockFocus } from './dock-focus';
import { StackNode } from './dock-node';
import { DockPanelRegistry } from './dock-panel-registry';
import { DockReveal } from './dock-reveal';
import { DockState } from './dock-state';
import { findStackOfPanel } from './dock-tree';

/**
 * A minimal panel body, registered so the floating layer accepts the panel under test.
 */
@Component({ template: '' })
class StubPanelBody {}

describe('DockReveal', () => {
  let reveal: DockReveal;
  let state: DockState;
  let autoHide: DockAutoHide;
  let floating: DockFloating;
  let focus: DockFocus;

  /**
   * Resolves the stack holding a panel in the current layout.
   * @param panelId The panel whose stack to resolve.
   * @returns Returns the stack.
   */
  function stackOf(panelId: string): StackNode {
    const stack: StackNode | null = findStackOfPanel(state.layout(), panelId);
    expect(stack).not.toBeNull();
    return stack!;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    reveal = TestBed.inject(DockReveal);
    state = TestBed.inject(DockState);
    autoHide = TestBed.inject(DockAutoHide);
    floating = TestBed.inject(DockFloating);
    focus = TestBed.inject(DockFocus);
  });

  it('reveal_whenTheStackIsExpanded_activatesThePanelAndFocusesItsStack', () => {
    const stack: StackNode = stackOf('terminal');
    state.setActive(stack.id, 'output');

    reveal.reveal('terminal');

    expect(stackOf('terminal').active).toBe('terminal');
    expect(focus.focusedStackId()).toBe(stack.id);
  });

  it('reveal_whenTheStackIsCollapsed_peeksItWithThePanelActive', () => {
    const stack: StackNode = stackOf('terminal');
    autoHide.pin(stack.id);

    reveal.reveal('terminal');

    expect(autoHide.flyoutStackId()).toBe(stack.id);
    expect(stackOf('terminal').active).toBe('terminal');
  });

  it('reveal_whenTheStackIsAlreadyPeekingThePanel_keepsThePeekOpen', () => {
    const stack: StackNode = stackOf('terminal');
    autoHide.pin(stack.id);
    autoHide.showFlyout(stack.id, 'terminal');

    // Going through showFlyout again would toggle the peek closed; revealing must not.
    reveal.reveal('terminal');

    expect(autoHide.flyoutStackId()).toBe(stack.id);
    expect(stackOf('terminal').active).toBe('terminal');
  });

  it('reveal_whenTheStackIsPeekingAnotherPanel_switchesTheActivePanel', () => {
    const stack: StackNode = stackOf('terminal');
    autoHide.pin(stack.id);
    autoHide.showFlyout(stack.id, 'output');

    reveal.reveal('terminal');

    expect(autoHide.flyoutStackId()).toBe(stack.id);
    expect(stackOf('terminal').active).toBe('terminal');
  });

  it('reveal_whenThePanelIsFloating_bringsItsWindowToTheFront', () => {
    // Floating requires the panel to be catalogued; register a stub descriptor for it.
    TestBed.inject(DockPanelRegistry).register({
      id: 'terminal',
      title: 'Terminal',
      icon: Icon.TERMINAL,
      role: 'tool',
      component: StubPanelBody,
    });
    floating.float('terminal', { left: 10, top: 10, width: 300, height: 200 });
    expect(floating.floats()).toHaveLength(1);
    const bringToFront: ReturnType<typeof vi.spyOn> = vi.spyOn(floating, 'bringToFront');

    reveal.reveal('terminal');

    expect(bringToFront).toHaveBeenCalledWith('terminal');
  });

  it('reveal_whenThePanelIsNowhere_isIgnored', () => {
    const before: unknown = state.layout();

    reveal.reveal('missing-panel');

    expect(state.layout()).toBe(before);
    expect(autoHide.flyoutStackId()).toBeNull();
  });
});
