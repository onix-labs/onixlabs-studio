import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { MirrorAction, MirrorState } from '@shared/api/terminal-mirror-channels';
import { DockNode, StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import { PopoutPanels } from '@shared/angular/services/dock-layout/popout-panels';
import { Studio } from '@shared/angular/services/studio/studio';
import { TerminalMirrorBridge } from '@shared/angular/services/terminal-mirror/terminal-mirror-bridge';
import {
  TerminalSession,
  TerminalSessions,
} from '@shared/angular/services/terminal-sessions/terminal-sessions';
import { TerminalPopout } from './terminal-popout';

/**
 * Builds the session used across these specs.
 * @param id The session identifier.
 * @returns Returns the session.
 */
function session(id: string): TerminalSession {
  return { id, name: `Terminal ${id}`, kind: 'shell', generation: 0, exitCode: null, cwd: '/work/proj' };
}

/**
 * Builds a dock tree with a tool stack (id `tools`) holding the given panels.
 * @param panels The tool stack's panel identifiers.
 * @returns Returns the tree.
 */
function tree(panels: readonly string[]): DockNode {
  return {
    kind: 'split',
    id: 'root',
    dir: 'col',
    children: [
      { kind: 'stack', id: 'well', role: 'document', panels: [], active: null },
      { kind: 'stack', id: 'tools', role: 'tool', panels: [...panels], active: panels[0] ?? null },
    ],
    sizes: [70, 30],
  };
}

describe('TerminalPopout', () => {
  let items: WritableSignal<readonly TerminalSession[]>;
  let activeId: WritableSignal<string | null>;
  let layout: WritableSignal<DockNode>;
  let root: WritableSignal<string | null>;
  let readyListener: (popoutId: number) => void;
  let actionListener: (popoutId: number, action: MirrorAction) => void;
  let closedListener: (popoutId: number) => void;
  let studio: {
    openPopoutWindow: ReturnType<typeof vi.fn>;
    closePopoutWindow: ReturnType<typeof vi.fn>;
    focusPopoutWindow: ReturnType<typeof vi.fn>;
    onPopoutClosed: (listener: (id: number) => void) => () => void;
  };
  let mirror: {
    publish: ReturnType<typeof vi.fn>;
    onReady: (listener: (popoutId: number) => void) => () => void;
    onAction: (listener: (popoutId: number, action: MirrorAction) => void) => () => void;
  };
  let sessionsStore: {
    sessions: WritableSignal<readonly TerminalSession[]>;
    activeId: WritableSignal<string | null>;
    activate: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    rename: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let dockState: {
    layout: () => DockNode;
    removeFromLayout: ReturnType<typeof vi.fn>;
    tabInto: ReturnType<typeof vi.fn>;
    reorderTab: ReturnType<typeof vi.fn>;
    dockEdge: ReturnType<typeof vi.fn>;
  };
  let reveal: { reveal: ReturnType<typeof vi.fn> };
  let popout: TerminalPopout;

  beforeEach(() => {
    items = signal<readonly TerminalSession[]>([session('s1'), session('s2')]);
    activeId = signal<string | null>('s1');
    layout = signal<DockNode>(tree(['errors', 'terminal', 'debug']));
    root = signal<string | null>('/work/proj');
    studio = {
      openPopoutWindow: vi.fn((): Promise<number | null> => Promise.resolve(42)),
      closePopoutWindow: vi.fn((): Promise<boolean> => Promise.resolve(true)),
      focusPopoutWindow: vi.fn((): Promise<boolean> => Promise.resolve(true)),
      onPopoutClosed: (listener: (id: number) => void): (() => void) => {
        closedListener = listener;
        return (): void => undefined;
      },
    };
    mirror = {
      publish: vi.fn(),
      onReady: (listener: (popoutId: number) => void): (() => void) => {
        readyListener = listener;
        return (): void => undefined;
      },
      onAction: (listener: (popoutId: number, action: MirrorAction) => void): (() => void) => {
        actionListener = listener;
        return (): void => undefined;
      },
    };
    sessionsStore = {
      sessions: items,
      activeId,
      activate: vi.fn(),
      close: vi.fn(),
      rename: vi.fn(),
      create: vi.fn(),
    };
    /**
     * Rewrites the `tools` stack's panel list inside the current layout, mirroring what the real
     * dock transforms would do.
     * @param mutate Produces the new panel list from the current one.
     */
    const mutateToolPanels: (mutate: (panels: readonly string[]) => readonly string[]) => void = (
      mutate: (panels: readonly string[]) => readonly string[],
    ): void => {
      layout.update((current: DockNode): DockNode => {
        if (current.kind !== 'split') {
          return current;
        }
        return {
          ...current,
          children: current.children.map((child: DockNode): DockNode => {
            if (child.kind !== 'stack' || child.id !== 'tools') {
              return child;
            }
            const panels: readonly string[] = mutate(child.panels);
            return { ...child, panels: [...panels] } satisfies StackNode;
          }),
        };
      });
    };
    dockState = {
      layout: (): DockNode => layout(),
      removeFromLayout: vi.fn((panelId: string): void => {
        mutateToolPanels((panels: readonly string[]): readonly string[] =>
          panels.filter((id: string): boolean => id !== panelId),
        );
      }),
      tabInto: vi.fn((stackId: string, panelId: string): void => {
        if (stackId === 'tools') {
          mutateToolPanels((panels: readonly string[]): readonly string[] => [...panels, panelId]);
        }
      }),
      reorderTab: vi.fn(),
      dockEdge: vi.fn(),
    };
    reveal = { reveal: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        TerminalPopout,
        PopoutPanels,
        { provide: Studio, useValue: studio },
        { provide: TerminalMirrorBridge, useValue: mirror },
        { provide: TerminalSessions, useValue: sessionsStore },
        { provide: DockState, useValue: dockState },
        { provide: DockReveal, useValue: reveal },
        { provide: DockTabContext, useValue: { root } },
      ],
    });
    popout = TestBed.inject(TerminalPopout);
  });

  it('popOut_opensAWindowRemovesThePanelAndMarksItPopped', async () => {
    await popout.popOut();
    expect(studio.openPopoutWindow).toHaveBeenCalledWith({
      panel: 'terminal',
      title: 'Terminal — proj',
    });
    expect(dockState.removeFromLayout).toHaveBeenCalledWith('terminal');
    expect(TestBed.inject(PopoutPanels).isPopped('terminal')).toBe(true);
    expect(popout.poppedOut()).toBe(true);
  });

  it('popOut_whenAlreadyPopped_focusesTheExistingWindow', async () => {
    await popout.popOut();
    await popout.popOut();
    expect(studio.openPopoutWindow).toHaveBeenCalledTimes(1);
    expect(studio.focusPopoutWindow).toHaveBeenCalledWith(42);
  });

  it('popOut_whenTheWindowIsRefused_leavesThePanelInPlace', async () => {
    studio.openPopoutWindow.mockResolvedValueOnce(null);
    await popout.popOut();
    expect(dockState.removeFromLayout).not.toHaveBeenCalled();
    expect(popout.poppedOut()).toBe(false);
  });

  it('ready_fromTheOwnPopout_publishesTheCurrentState', async () => {
    await popout.popOut();
    mirror.publish.mockClear();
    readyListener(42);
    const state: MirrorState = mirror.publish.mock.calls[0][1] as MirrorState;
    expect(mirror.publish).toHaveBeenCalledWith(42, expect.anything());
    expect(state.sessions.map((entry): string => entry.id)).toEqual(['s1', 's2']);
    expect(state.activeId).toBe('s1');
    expect(state.root).toBe('/work/proj');
  });

  it('ready_fromAnotherWindow_isIgnored', async () => {
    await popout.popOut();
    mirror.publish.mockClear();
    readyListener(99);
    expect(mirror.publish).not.toHaveBeenCalled();
  });

  it('ownerChanges_whilePopped_republish', async () => {
    await popout.popOut();
    TestBed.tick();
    mirror.publish.mockClear();
    items.update((current: readonly TerminalSession[]): readonly TerminalSession[] => [
      ...current,
      session('s3'),
    ]);
    TestBed.tick();
    expect(mirror.publish).toHaveBeenCalled();
  });

  it('actions_fromTheOwnPopout_applyToTheOwningStore', async () => {
    await popout.popOut();
    actionListener(42, { kind: 'activate', id: 's2' });
    expect(sessionsStore.activate).toHaveBeenCalledWith('s2');
    actionListener(42, { kind: 'close', id: 's2' });
    expect(sessionsStore.close).toHaveBeenCalledWith('s2');
    actionListener(42, { kind: 'rename', id: 's1', name: 'Build' });
    expect(sessionsStore.rename).toHaveBeenCalledWith('s1', 'Build');
    actionListener(42, { kind: 'new-shell' });
    expect(sessionsStore.create).toHaveBeenCalled();
    actionListener(42, { kind: 'dock-back' });
    expect(studio.closePopoutWindow).toHaveBeenCalledWith(42);
  });

  it('actions_fromAnotherWindow_areIgnored', async () => {
    await popout.popOut();
    actionListener(99, { kind: 'activate', id: 's2' });
    expect(sessionsStore.activate).not.toHaveBeenCalled();
  });

  it('windowClose_returnsThePanelToItsOriginTabPosition', async () => {
    await popout.popOut();
    closedListener(42);
    expect(dockState.tabInto).toHaveBeenCalledWith('tools', 'terminal');
    // Origin index was 1 (between errors and debug); the re-added tab lands last and is moved back.
    expect(dockState.reorderTab).toHaveBeenCalledWith('tools', 2, 1);
    expect(reveal.reveal).toHaveBeenCalledWith('terminal');
    expect(TestBed.inject(PopoutPanels).isPopped('terminal')).toBe(false);
    expect(popout.poppedOut()).toBe(false);
  });

  it('windowClose_whenTheOriginStackIsGone_docksToTheBottomEdge', async () => {
    await popout.popOut();
    layout.set({
      kind: 'split',
      id: 'root',
      dir: 'col',
      children: [{ kind: 'stack', id: 'well', role: 'document', panels: [], active: null }],
      sizes: [100],
    });
    closedListener(42);
    expect(dockState.dockEdge).toHaveBeenCalledWith('terminal', 'bottom');
    expect(reveal.reveal).toHaveBeenCalledWith('terminal');
  });

  it('closeOfAnotherWindow_isIgnored', async () => {
    await popout.popOut();
    closedListener(99);
    expect(popout.poppedOut()).toBe(true);
    expect(dockState.tabInto).not.toHaveBeenCalled();
  });

  it('emptySessions_whilePopped_closeThePopout', async () => {
    await popout.popOut();
    TestBed.tick();
    items.set([]);
    TestBed.tick();
    expect(studio.closePopoutWindow).toHaveBeenCalledWith(42);
  });

  it('destroy_closesThePopoutWindowWithoutReDocking', async () => {
    await popout.popOut();
    popout.ngOnDestroy();
    expect(studio.closePopoutWindow).toHaveBeenCalledWith(42);
    expect(dockState.tabInto).not.toHaveBeenCalled();
  });
});
