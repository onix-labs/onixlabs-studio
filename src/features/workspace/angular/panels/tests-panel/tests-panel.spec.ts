import { computed, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestNode } from '@shared/api/test-adapter-protocol';
import type { TestAdapterInfo } from '@shared/api/test-channels';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import { Icon } from '@shared/angular/icons/icon';
import {
  TestAdapterProblem,
  TestExplorer,
  TestExplorerPhase,
} from '@features/workspace/angular/tests/test-explorer';
import {
  indexTree,
  TestEntry,
  testKey,
  TestState,
} from '@features/workspace/angular/tests/test-tree';
import { TestsPanel } from './tests-panel';

/**
 * The tree the stand-in explorer holds.
 */
const TREE: readonly TestNode[] = [
  {
    id: 'project',
    label: 'Shop.Tests',
    kind: 'project',
    framework: 'xUnit',
    children: [
      { id: 'Adds', label: 'Adds', kind: 'test', location: { file: '/repo/A.cs', line: 8 } },
      { id: 'Fails', label: 'Fails', kind: 'test', location: { file: '/repo/A.cs', line: 14 } },
    ],
  },
];

describe('TestsPanel (#1352)', () => {
  let fixture: ComponentFixture<TestsPanel>;
  let tree: WritableSignal<readonly TestNode[]>;
  let adapters: WritableSignal<readonly TestAdapterInfo[]>;
  let states: WritableSignal<ReadonlyMap<string, TestState>>;
  let phase: WritableSignal<TestExplorerPhase>;
  let problems: WritableSignal<ReadonlyMap<string, TestAdapterProblem>>;
  let explorer: Record<string, unknown>;
  let goTo: ReturnType<typeof vi.fn>;

  const panel: DockPanel = {
    id: 'tests',
    title: 'Tests',
    icon: Icon.TEST,
    role: 'tool',
    component: TestsPanel,
  };

  beforeEach(async () => {
    tree = signal<readonly TestNode[]>(TREE);
    adapters = signal<readonly TestAdapterInfo[]>([
      {
        pluginId: 'dotnet',
        displayName: '.NET Tests',
        frameworks: ['xUnit'],
        installed: true,
        capabilities: ['run', 'debug'],
      },
    ]);
    states = signal<ReadonlyMap<string, TestState>>(new Map<string, TestState>());
    phase = signal<TestExplorerPhase>('idle');
    problems = signal<ReadonlyMap<string, TestAdapterProblem>>(
      new Map<string, TestAdapterProblem>(),
    );
    explorer = {
      adapters,
      installed: computed(() => adapters().filter((adapter: TestAdapterInfo) => adapter.installed)),
      problems,
      states,
      running: signal(new Set<string>()),
      queued: signal(new Set<string>()),
      phase,
      runProblem: signal<string | null>(null),
      index: computed(() => {
        const index: Map<string, TestEntry> = new Map<string, TestEntry>();
        indexTree('dotnet', tree(), index);
        return index;
      }),
      hasFailures: signal(false),
      can: (_pluginId: string, capability: string): boolean =>
        capability === 'debug' || capability === 'run',
      hasOutput: (): boolean => false,
      runAll: vi.fn(() => Promise.resolve(true)),
      runFailed: vi.fn(() => Promise.resolve(true)),
      run: vi.fn(() => Promise.resolve(true)),
      debug: vi.fn(() => Promise.resolve(true)),
      stop: vi.fn(),
      refresh: vi.fn(() => Promise.resolve()),
      showOutput: vi.fn(),
    };
    goTo = vi.fn(() => Promise.resolve());
    await TestBed.configureTestingModule({
      imports: [TestsPanel],
      providers: [
        { provide: TestExplorer, useValue: explorer },
        { provide: EditorNavigation, useValue: { goTo } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TestsPanel);
    fixture.componentRef.setInput('panel', panel);
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
  });

  /**
   * Reads the panel's text.
   * @returns Returns the text.
   */
  function text(): string {
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  /**
   * Finds a strip button by its label or tooltip.
   * @param name The label.
   * @returns Returns the button.
   */
  function button(name: string): HTMLButtonElement {
    fixture.detectChanges();
    const found: HTMLButtonElement | undefined = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        'app-panel-toolbar button',
      ),
    ].find(
      (candidate: HTMLButtonElement): boolean =>
        candidate.textContent?.includes(name) === true ||
        candidate.getAttribute('aria-label') === name,
    );
    if (found === undefined) {
      throw new Error(`No button ${name}`);
    }
    return found;
  }

  it('render_showsTheTreeAndTheStatusStripTallies', () => {
    states.set(new Map([[testKey('dotnet', 'Adds'), { outcome: 'passed', durationMs: 4 }]]));

    const shown: string = text();

    expect(shown).toContain('Shop.Tests');
    expect(shown).toContain('Adds');
    expect(shown).toContain('xUnit');
    expect(shown).toContain('2 tests');
    expect(shown).toContain('1 passed');
    expect(shown).toContain('4 ms');
  });

  it('runAll_runsEveryTest_andRunFailedWaitsForAFailure', () => {
    button('Run All').click();

    expect(explorer['runAll']).toHaveBeenCalled();
    expect(button('Run Failed').disabled).toBe(true);
  });

  it('whileRunning_theStripOffersStopInsteadOfRunAll', () => {
    phase.set('running');

    button('Stop').click();

    expect(explorer['stop']).toHaveBeenCalled();
    expect(text()).toContain('Running');
  });

  it('selectingAFailedTest_showsItsMessage', () => {
    states.set(
      new Map([
        [testKey('dotnet', 'Fails'), { outcome: 'failed', message: 'Expected 2 but was 3' }],
      ]),
    );
    fixture.detectChanges();
    const row: HTMLElement | undefined = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.tree-name'),
    ].find((candidate: HTMLElement): boolean => candidate.textContent === 'Fails');
    row?.click();

    expect(text()).toContain('Expected 2 but was 3');
    expect(button('Debug Test').disabled).toBe(false);
  });

  it.each<[string, () => void, string]>([
    [
      'no adapter is installed',
      (): void => {
        tree.set([]);
        adapters.set([
          {
            pluginId: 'dotnet',
            displayName: '.NET Tests',
            frameworks: ['xUnit', 'NUnit'],
            installed: false,
            capabilities: [],
          },
        ]);
      },
      'Install .NET Tests in the Plugin Manager',
    ],
    [
      'the folder is not trusted',
      (): void => {
        tree.set([]);
        problems.set(new Map([['dotnet', { message: 'not trusted', code: 'untrusted' }]]));
      },
      'Trust this folder to find and run its tests.',
    ],
    [
      'tests are being found',
      (): void => {
        tree.set([]);
        phase.set('discovering');
      },
      'Finding Tests',
    ],
    ['nothing was found', (): void => tree.set([]), 'No tests found in this workspace.'],
  ])('emptyState_when %s', (_name: string, arrange: () => void, expected: string) => {
    arrange();

    expect(text()).toContain(expected);
  });
});
