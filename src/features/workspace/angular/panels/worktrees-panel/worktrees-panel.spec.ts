import { computed, signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { Icon } from '@shared/angular/icons/icon';
import { ListMenuSelection, ListRow } from '@shared/angular/components/list-view/list-view';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { Shell } from '@shared/angular/services/shell/shell';
import {
  WorktreeCheckoutInfo,
  WorktreeCheckoutStatus,
  WorktreeDescriptor,
  WorktreeOutcome,
} from '@shared/api/worktree';
import { WorktreeSession } from '@features/workspace/angular/worktree/worktree-session';

import { WorktreesPanel } from './worktrees-panel';

/**
 * The synthetic row id of the inert Orchestrator entry, mirrored here so the tests can name it.
 */
const ORCHESTRATOR_ID: string = 'orchestrator';

/**
 * Builds a checkout with the given id and path.
 * @param id The checkout id.
 * @param path The checkout's directory.
 * @returns Returns the checkout.
 */
function checkout(id: string, path: string): WorktreeCheckoutInfo {
  return { id, path, exists: true, branch: 'main' };
}

/**
 * A fake worktree session exposing just the surface the panel reads, with the checkouts and busy
 * state each test needs.
 */
class FakeSession {
  public readonly checkouts: WritableSignal<readonly WorktreeCheckoutInfo[]> = signal<
    readonly WorktreeCheckoutInfo[]
  >([checkout('a', '/work/a'), checkout('b', '/work/b')]);
  public readonly busy: WritableSignal<'add' | 'remove' | null> = signal<'add' | 'remove' | null>(
    null,
  );
  public readonly activeId: WritableSignal<string | null> = signal<string | null>('a');
  public readonly statuses: Signal<ReadonlyMap<string, WorktreeCheckoutStatus>> = signal<
    ReadonlyMap<string, WorktreeCheckoutStatus>
  >(new Map<string, WorktreeCheckoutStatus>());
  public readonly agentActivity: Signal<ReadonlyMap<string, Signal<boolean>>> = signal<
    ReadonlyMap<string, Signal<boolean>>
  >(new Map<string, Signal<boolean>>());
  public readonly duplicateBranches: Signal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );
  public readonly removed: string[] = [];

  /**
   * Presents a descriptor built from the checkout list each test controls, since the panel reads its
   * rows off the descriptor rather than off the list directly.
   */
  public readonly descriptor: Signal<WorktreeDescriptor | null> = computed(
    (): WorktreeDescriptor => ({ checkouts: this.checkouts() }) as WorktreeDescriptor,
  );

  public labelFor(id: string): string {
    return id.toUpperCase();
  }

  public activate(id: string): void {
    this.activeId.set(id);
  }

  public remove(id: string): Promise<WorktreeOutcome<null>> {
    this.removed.push(id);
    return Promise.resolve({ ok: true, value: null } as WorktreeOutcome<null>);
  }

  public refresh(): Promise<void> {
    return Promise.resolve();
  }

  public loadBranches(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
}

/**
 * A fake shell recording revealed paths.
 */
class FakeShell {
  public readonly revealed: string[] = [];

  public revealPath(path: string): Promise<void> {
    this.revealed.push(path);
    return Promise.resolve();
  }
}

describe('WorktreesPanel row context menu', () => {
  let component: WorktreesPanel;
  let fixture: ComponentFixture<WorktreesPanel>;
  let session: FakeSession;
  let shell: FakeShell;

  const panel: DockPanel = {
    id: 'worktrees',
    title: 'Worktrees',
    icon: Icon.WORKTREE,
    role: 'tool',
    component: WorktreesPanel,
  };

  beforeEach(async () => {
    session = new FakeSession();
    shell = new FakeShell();

    await TestBed.configureTestingModule({
      imports: [WorktreesPanel],
      providers: [
        { provide: WorktreeSession, useValue: session },
        { provide: Shell, useValue: shell },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorktreesPanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panel', panel);
    fixture.detectChanges();
  });

  /**
   * Builds the list row a menu would be opened on for a checkout.
   * @param id The checkout id.
   * @returns Returns the list row.
   */
  function rowFor(id: string): ListRow {
    const entry: WorktreeCheckoutInfo | undefined = session
      .checkouts()
      .find((candidate: WorktreeCheckoutInfo): boolean => candidate.id === id);
    return { id, data: entry ?? null };
  }

  /**
   * Gets the ids the menu offers for a row, dropping the separators.
   * @param row The row to open a menu on.
   * @returns Returns the item ids.
   */
  function itemIds(row: ListRow): readonly string[] {
    return component
      .contextMenuFor(row)
      .filter((item: MenuItem): boolean => item.separator !== true)
      .map((item: MenuItem): string => item.id);
  }

  it('contextMenuFor_aCheckout_offersRevealCopyPathAndRemove', () => {
    expect(itemIds(rowFor('a'))).toEqual(['reveal', 'copy-path', 'remove']);
  });

  it('contextMenuFor_theOrchestratorRow_offersNothingSoNoMenuOpens', () => {
    // It stands for a coordinating agent that does not exist yet — no directory to reveal, nothing to
    // remove — and an empty panel on it would read as a bug rather than as an answer.
    expect(component.contextMenuFor({ id: ORCHESTRATOR_ID, data: null })).toEqual([]);
  });

  it('contextMenuFor_theLastRemainingCheckout_omitsRemove', () => {
    // A container never becomes empty from this panel, and that is a rule about the container rather
    // than a state the user can clear — so a greyed row would only invite them to keep trying.
    session.checkouts.set([checkout('a', '/work/a')]);
    fixture.detectChanges();

    expect(itemIds(rowFor('a'))).toEqual(['reveal', 'copy-path']);
  });

  it('contextMenuFor_whileAMutationIsInFlight_omitsRemove', () => {
    session.busy.set('remove');
    fixture.detectChanges();

    expect(itemIds(rowFor('a'))).not.toContain('remove');
  });

  it('contextMenuFor_remove_wearsTheDangerTone', () => {
    const remove: MenuItem | undefined = component
      .contextMenuFor(rowFor('a'))
      .find((item: MenuItem): boolean => item.id === 'remove');

    expect(remove?.tone).toBe('danger');
  });

  it('onContextAction_reveal_revealsThatCheckoutsDirectory', () => {
    component.onContextAction({ itemId: 'reveal', row: rowFor('b') } satisfies ListMenuSelection);

    expect(shell.revealed).toEqual(['/work/b']);
  });

  it('onContextAction_remove_asksBeforeRemovingAnything', () => {
    component.onContextAction({ itemId: 'remove', row: rowFor('b') } satisfies ListMenuSelection);

    // The existing confirmation still stands between the command and the removal.
    expect(component.removeTarget()).toBe('b');
    expect(session.removed).toEqual([]);
  });

  it('onContextAction_theOrchestratorRow_doesNothing', () => {
    component.onContextAction({
      itemId: 'remove',
      row: { id: ORCHESTRATOR_ID, data: null },
    } satisfies ListMenuSelection);

    expect(session.removed).toEqual([]);
  });

  it('render_noLongerPutsATrashButtonOnEachRow', () => {
    // The command has a home now, and the panels do not put buttons on list rows.
    const buttons: NodeListOf<Element> = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.worktrees__entry app-button',
    );

    expect(buttons).toHaveLength(0);
  });
});
