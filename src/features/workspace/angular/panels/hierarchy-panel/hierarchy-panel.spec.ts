import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import type {
  HierarchyDirection,
  HierarchyNode,
  HierarchySource,
} from '@shared/angular/services/hierarchy/hierarchy';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import { HierarchyPanel } from './hierarchy-panel';
import { HierarchyPanelState } from './hierarchy-panel-state';

/**
 * Builds a node.
 * @param name The symbol's name.
 * @param line Its line.
 * @returns Returns the node.
 */
function node(name: string, line: number): HierarchyNode {
  return {
    name,
    detail: 'Fixture.Services',
    kind: 6,
    location: {
      path: `/root/${name}.cs`,
      range: { startLineNumber: line, startColumn: 5, endLineNumber: line, endColumn: 10 },
    },
    item: { name },
  };
}

const ROOT: HierarchyNode = node('Greet', 11);
const MAIN: HierarchyNode = node('Main', 5);
const RUN: HierarchyNode = node('Run', 3);
const FORMAT: HierarchyNode = node('Format', 2);

describe('HierarchyPanel (#1153)', () => {
  let fixture: ComponentFixture<HierarchyPanel>;
  let state: HierarchyPanelState;
  let host: HTMLElement;
  let asked: { node: string; direction: HierarchyDirection }[];
  let answers: Map<string, (found: readonly HierarchyNode[] | null) => void>;
  let goTo: MockInstance<EditorNavigation['goTo']>;

  /**
   * Builds a call hierarchy whose every walk waits for the spec to answer it.
   * @returns Returns the hierarchy.
   */
  function source(): HierarchySource {
    return {
      kind: 'calls',
      roots: [ROOT],
      children: (
        from: HierarchyNode,
        direction: HierarchyDirection,
      ): Promise<readonly HierarchyNode[] | null> => {
        asked.push({ node: from.name, direction });
        return new Promise<readonly HierarchyNode[] | null>(
          (resolve: (found: readonly HierarchyNode[] | null) => void): void =>
            void answers.set(`${from.name}:${direction}`, resolve),
        );
      },
    };
  }

  /**
   * Answers a walk and lets the panel render it.
   * @param key The walk, `<node>:<direction>`.
   * @param found What it found.
   */
  async function answer(key: string, found: readonly HierarchyNode[] | null): Promise<void> {
    answers.get(key)?.(found);
    // The panel records the answer as the walk's promise settles, after which it renders.
    await Promise.resolve();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /**
   * Reads the tree's rows as text.
   * @returns Returns each row's label.
   */
  function rows(): string[] {
    return [...host.querySelectorAll<HTMLElement>('.tree-row')].map((row: HTMLElement): string =>
      (row.querySelector('.tree-name')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  }

  beforeEach(async () => {
    asked = [];
    answers = new Map();
    await TestBed.configureTestingModule({
      imports: [HierarchyPanel],
      providers: [HierarchyPanelState],
    }).compileComponents();
    state = TestBed.inject(HierarchyPanelState);
    goTo = vi.spyOn(TestBed.inject(EditorNavigation), 'goTo').mockResolvedValue(undefined);
    fixture = TestBed.createComponent(HierarchyPanel);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('saysHowToFillIt_beforeAHierarchyIsAskedFor', () => {
    expect(host.querySelector('.tree-empty')?.textContent).toContain('Show Call Hierarchy (⌃⌥H)');
  });

  it('opensOnTheRootsCallers_expandingEachLevelOnlyWhenAsked', async () => {
    state.show(source());
    await fixture.whenStable();

    expect(host.querySelector('.hierarchy-panel__heading')?.textContent).toBe('Callers of Greet');
    expect(asked).toEqual([{ node: 'Greet', direction: 'callers' }]);
    expect(rows()).toEqual(['Greet Fixture.Services', 'Loading…']);

    await answer('Greet:callers', [MAIN, RUN]);
    expect(rows()).toEqual([
      'Greet Fixture.Services',
      'Main Fixture.Services',
      'Run Fixture.Services',
    ]);

    host.querySelectorAll<HTMLElement>('.tree-row')[1].click();
    await fixture.whenStable();
    expect(goTo).toHaveBeenCalledWith(null, MAIN.location, true);
    expect(asked.at(-1)).toEqual({ node: 'Main', direction: 'callers' });

    // A symbol nothing calls stops being expandable.
    await answer('Main:callers', []);
    expect(rows()).toHaveLength(3);
    expect(host.querySelectorAll('.tree-row')[1].getAttribute('aria-expanded')).toBeNull();
  });

  it('theSwitch_walksTheOtherWay_fromTheSameRoot_droppingTheOldWalksLateAnswer', async () => {
    state.show(source());
    await fixture.whenStable();

    host
      .querySelectorAll<HTMLButtonElement>('app-button-group button')
      .forEach((button: HTMLButtonElement): void => {
        if (button.textContent?.includes('Callees')) {
          button.click();
        }
      });
    await fixture.whenStable();
    await answer('Greet:callers', [MAIN]);

    expect(host.querySelector('.hierarchy-panel__heading')?.textContent).toBe('Calls from Greet');
    expect(asked.at(-1)).toEqual({ node: 'Greet', direction: 'callees' });
    expect(rows()).toEqual(['Greet Fixture.Services', 'Loading…']);

    await answer('Greet:callees', [FORMAT]);
    expect(rows()).toEqual(['Greet Fixture.Services', 'Format Fixture.Services']);
  });

  it('aWalkThatFails_saysSo_andATypeHierarchyOpensOnItsBaseTypes', async () => {
    state.show(source());
    await fixture.whenStable();
    await answer('Greet:callers', null);
    expect(rows()).toEqual(['Greet Fixture.Services', 'Could not be found.']);

    state.show({ ...source(), kind: 'types', roots: [node('FormalGreeter', 4)] });
    await fixture.whenStable();
    expect(host.querySelector('.hierarchy-panel__heading')?.textContent).toBe(
      'Base types of FormalGreeter',
    );
    expect(asked.at(-1)).toEqual({ node: 'FormalGreeter', direction: 'supertypes' });
  });

  it('noRoots_saysThereIsNoHierarchyAtTheCaret', async () => {
    state.show({ ...source(), roots: [] });
    await fixture.whenStable();

    expect(host.querySelector('.tree-empty')?.textContent).toContain(
      'There is no call hierarchy for the symbol at the caret.',
    );
  });
});
