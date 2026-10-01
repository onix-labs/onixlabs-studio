import { beforeEach, describe, expect, it } from 'vitest';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AiBridgeScope } from '@shared/api/ai-types';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import {
  ActiveWorkspace,
  WellTerminal,
  WorkspaceWell,
  WorkspaceWellHandlers,
} from './active-workspace';

/**
 * Builds the handlers a workspace view publishes, reporting a root and a set of terminals.
 * @param root The workspace root.
 * @param terminalIds The ids of the terminals in the workspace's dock.
 * @returns Returns the handlers.
 */
function handlersFor(root: string, terminalIds: readonly string[] = []): WorkspaceWellHandlers {
  return {
    rootPath: (): string | null => root,
    activeDocumentId: (): string | null => `${root}#active`,
    open: (): Promise<boolean> => Promise.resolve(true),
    openDiff: (): Promise<string | null> => Promise.resolve(null),
    documents: () => [],
    sourceControl: () => null,
    openTerminal: (): WellTerminal => ({ id: 'new', name: 'new', active: true }),
    terminals: (): readonly WellTerminal[] =>
      terminalIds.map((id: string): WellTerminal => ({ id, name: id, active: false })),
    createFile: (): Promise<string | null> => Promise.resolve(null),
    createFolder: (): Promise<string | null> => Promise.resolve(null),
    rename: () => Promise.resolve({ path: null, error: null }),
    delete: () => Promise.resolve({ trashed: true, error: null }),
    reveal: (): Promise<boolean> => Promise.resolve(true),
  };
}

/**
 * Builds a run scope.
 * @param owningTabId The run's owner.
 * @param surface The run's surface.
 * @param workspaceRoot The run's workspace root.
 * @returns Returns the scope.
 */
function scope(
  owningTabId: string | null,
  surface: AiBridgeScope['surface'] = 'workspace',
  workspaceRoot: string | null = null,
): AiBridgeScope {
  return { owningTabId, surface, workspaceRoot };
}

describe('ActiveWorkspace', () => {
  let active: WritableSignal<string | undefined>;
  let workspace: ActiveWorkspace;

  beforeEach(() => {
    active = signal<string | undefined>(undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: Tabs, useValue: { activeTabId: active.asReadonly() } }],
    });
    workspace = TestBed.inject(ActiveWorkspace);
    workspace.setWell('tab-a', 'tab-a', handlersFor('/a', ['term-a']));
    workspace.setWell('tab-b', 'tab-b', handlersFor('/b', ['term-b']));
  });

  it('wellForRun_whenTheRunOwnsAWell_returnsItsOwnWellNotTheFocusedOne', () => {
    // The user is looking at workspace B; workspace A's agent must still reach A.
    active.set('tab-b');

    expect(workspace.wellForRun(scope('tab-a'))?.root).toBe('/a');
  });

  it('wellForRun_whenAWorkspaceRunOwnsNoWell_returnsNullRatherThanBorrowingOne', () => {
    active.set('tab-b');

    expect(workspace.wellForRun(scope('gone'))).toBeNull();
    expect(workspace.wellForRun(scope(null))).toBeNull();
  });

  it('wellForRun_whenAnotherSurfaceActsWithinAWorkspaceRoot_returnsThatWorkspace', () => {
    active.set('tab-b');

    expect(workspace.wellForRun(scope('agent-tab', 'project', '/a'))?.root).toBe('/a');
  });

  it('wellForRun_whenOutsideAnyWorkspace_fallsBackToTheFocusedOneOnlyWhenAllowed', () => {
    active.set('tab-b');

    expect(workspace.wellForRun(scope('terminal-tab', 'terminal'))?.root).toBe('/b');
    expect(workspace.wellForRun(scope('terminal-tab', 'terminal'), false)).toBeNull();
  });

  it('setWell_whenTwoSubViewsShareATab_keepsBothWells', () => {
    workspace.setWell('tab-c:one', 'tab-c', handlersFor('/c1'));
    workspace.setWell('tab-c:two', 'tab-c', handlersFor('/c2'));

    expect(workspace.wellForRun(scope('tab-c:one'))?.root).toBe('/c1');
    expect(workspace.wellForRun(scope('tab-c:two'))?.root).toBe('/c2');
  });

  it('clearWell_whenASuccessorRepublishedTheScope_keepsTheSuccessor', () => {
    const successor: WorkspaceWellHandlers = handlersFor('/a2');
    const predecessor: WorkspaceWellHandlers = handlersFor('/a1');
    workspace.setWell('tab-x', 'tab-x', predecessor);
    workspace.setWell('tab-x', 'tab-x', successor);

    workspace.clearWell('tab-x', predecessor);

    expect(workspace.wellForRun(scope('tab-x'))?.root).toBe('/a2');
  });

  it('wellOwningTerminal_whenTheTerminalIsInAWorkspaceDock_returnsThatWorkspace', () => {
    const owner: WorkspaceWell | null = workspace.wellOwningTerminal('term-a');

    expect(owner?.scope).toBe('tab-a');
    expect(workspace.wellOwningTerminal('top-level-terminal')).toBeNull();
  });

  it('activeWell_whenTheActiveTabHasSubViews_prefersTheOneLastPublishedInIt', () => {
    workspace.setWell('tab-c:one', 'tab-c', handlersFor('/c1'));
    workspace.setWell('tab-c:two', 'tab-c', handlersFor('/c2'));
    workspace.setWell('tab-d', 'tab-d', handlersFor('/d'));
    active.set('tab-c');

    expect(workspace.activeWell()?.root).toBe('/c2');
  });
});

describe('ActiveWorkspace roots', () => {
  let activeWorkspace: ActiveWorkspace;
  let activeTabId: WritableSignal<string | undefined>;

  beforeEach(() => {
    activeTabId = signal<string | undefined>(undefined);
    TestBed.configureTestingModule({
      providers: [ActiveWorkspace, { provide: Tabs, useValue: { activeTabId } }],
    });
    activeWorkspace = TestBed.inject(ActiveWorkspace);
  });

  it('rootPath_whenNoActiveTab_isNull', () => {
    expect(activeWorkspace.rootPath()).toBeNull();
  });

  it('rootPath_reflectsTheActiveTabsPublishedRoot', () => {
    activeWorkspace.setRoot('tab-1', '/projects/alpha');
    activeWorkspace.setRoot('tab-2', '/projects/beta');

    activeTabId.set('tab-2');

    expect(activeWorkspace.rootPath()).toBe('/projects/beta');
  });

  it('rootPath_whenActiveTabHasNoPublishedRoot_isNull', () => {
    activeWorkspace.setRoot('tab-1', '/projects/alpha');
    activeTabId.set('tab-other');

    expect(activeWorkspace.rootPath()).toBeNull();
  });

  it('clearRoot_dropsThePublishedRoot', () => {
    activeWorkspace.setRoot('tab-1', '/projects/alpha');
    activeTabId.set('tab-1');
    activeWorkspace.clearRoot('tab-1');

    expect(activeWorkspace.rootPath()).toBeNull();
  });
});
