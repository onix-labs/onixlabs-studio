import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DebugState } from '@shared/angular/services/debug/debugger';
import { Documents } from '@shared/angular/services/documents/documents';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import {
  DebugEvaluation,
  DebugFrame,
  DebugScope,
  DebugSession,
  DebugVariable,
} from '@features/workspace/angular/debug/debug-session';
import { TreeRow } from '@shared/angular/components/tree-view/tree-view';
import { DebugPanel } from './debug-panel';

/**
 * A controllable fake of the workspace debug session, exposing the signals and methods the panel reads.
 */
class FakeSession {
  public readonly state: WritableSignal<DebugState> = signal<DebugState>('stopped');
  public readonly callStack: WritableSignal<readonly DebugFrame[]> = signal<readonly DebugFrame[]>(
    [],
  );
  public readonly currentFrame: WritableSignal<number | null> = signal<number | null>(null);
  public readonly scopes: WritableSignal<readonly DebugScope[]> = signal<readonly DebugScope[]>([]);
  public readonly variablesByRef: Map<number, readonly DebugVariable[]> = new Map<
    number,
    readonly DebugVariable[]
  >();
  public evaluations: Map<string, DebugEvaluation> = new Map<string, DebugEvaluation>();
  public readonly selected: number[] = [];
  public readonly commands: string[] = [];

  public variables(reference: number): Promise<readonly DebugVariable[]> {
    return Promise.resolve(this.variablesByRef.get(reference) ?? []);
  }

  public evaluate(expression: string): Promise<DebugEvaluation> {
    return Promise.resolve(
      this.evaluations.get(expression) ?? { result: '?', variablesReference: 0, failed: false },
    );
  }

  public selectFrame(frameId: number): Promise<void> {
    this.selected.push(frameId);
    return Promise.resolve();
  }

  public continue(): void {
    this.commands.push('continue');
  }
  public pause(): void {
    this.commands.push('pause');
  }
  public stepOver(): void {
    this.commands.push('stepOver');
  }
  public stepIn(): void {
    this.commands.push('stepIn');
  }
  public stepOut(): void {
    this.commands.push('stepOut');
  }
  public stop(): void {
    this.commands.push('stop');
  }
}

/**
 * Records reveal requests dispatched to the editor registry.
 */
class FakeEditors {
  public readonly reveals: { id: string; line: number; column: number }[] = [];
  public requestReveal(documentId: string, line: number, column: number): void {
    this.reveals.push({ id: documentId, line, column });
  }
}

/**
 * A fake file opener recording the paths it was asked to open.
 */
class FakeOpener {
  public readonly opened: string[] = [];
  public openPath(path: string): Promise<boolean> {
    this.opened.push(path);
    return Promise.resolve(true);
  }
}

/**
 * The panel's template-facing members, exposed for the spec without widening the component's own
 * protected surface.
 */
interface Testable {
  callStackRows(): readonly TreeRow[];
  selectedFrameRow(): string | null;
  onFrameClick(row: TreeRow): void;
  variableRows(): readonly TreeRow[];
  onVariableClick(row: TreeRow): void;
  variableOf(row: TreeRow): { kind: string };
  newWatch: WritableSignal<string>;
  addWatch(): void;
  watchExpressions(): readonly string[];
  watchResult(expression: string): DebugEvaluation | undefined;
  removeWatch(expression: string): void;
  onContinue(): void;
  onStepOver(): void;
  onStepInto(): void;
  onStepOut(): void;
  onStop(): void;
}

/**
 * Resolves pending microtasks.
 * @returns Returns a promise that settles on the next macrotask.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

/**
 * Builds a frame.
 * @param overrides Fields to override.
 * @returns Returns the frame.
 */
function frame(overrides: Partial<DebugFrame> = {}): DebugFrame {
  return { id: 1, name: 'Main', path: '/ws/Program.cs', line: 5, column: 1, ...overrides };
}

describe('DebugPanel', () => {
  let session: FakeSession;
  let opener: FakeOpener;
  let editors: FakeEditors;
  let fixture: ComponentFixture<DebugPanel>;
  let component: DebugPanel;
  let c: Testable;

  const panel: DockPanel = { id: 'debug', title: 'Debug', icon: Icon.DEBUG, role: 'tool', component: DebugPanel };

  function build(): void {
    session = new FakeSession();
    opener = new FakeOpener();
    editors = new FakeEditors();
    TestBed.configureTestingModule({
      imports: [DebugPanel],
      providers: [
        { provide: DebugSession, useValue: session as unknown as DebugSession },
        { provide: FileOpener, useValue: opener as unknown as FileOpener },
        { provide: Editors, useValue: editors as unknown as Editors },
        { provide: Documents, useValue: { findIdByPath: (): string => 'doc1' } as unknown as Documents },
      ],
    });
    fixture = TestBed.createComponent(DebugPanel);
    component = fixture.componentInstance;
    c = component as unknown as Testable;
    fixture.componentRef.setInput('panel', panel);
  }

  beforeEach(() => {
    build();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('callStackRows_mapFramesAndMarkTheSelected', () => {
    session.callStack.set([frame({ id: 10, name: 'Main' }), frame({ id: 11, name: 'Outer' })]);
    session.currentFrame.set(10);
    fixture.detectChanges();

    const rows: readonly TreeRow[] = c.callStackRows();
    expect(rows.map((r) => r.id)).toEqual(['frame:10', 'frame:11']);
    expect(c.selectedFrameRow()).toBe('frame:10');
  });

  it('onFrameClick_selectsTheFrameAndRevealsItsSource', async () => {
    session.callStack.set([frame({ id: 10, path: '/ws/Program.cs', line: 7, column: 3 })]);
    fixture.detectChanges();
    const row: TreeRow = c.callStackRows()[0];

    c.onFrameClick(row);
    await flush();

    expect(session.selected).toEqual([10]);
    expect(opener.opened).toEqual(['/ws/Program.cs']);
    expect(editors.reveals).toEqual([{ id: 'doc1', line: 7, column: 3 }]);
  });

  it('variableRows_showScopesAndExpandToFetchChildren', async () => {
    session.scopes.set([{ name: 'Locals', variablesReference: 100, expensive: false }]);
    session.variablesByRef.set(100, [
      { name: 'x', value: '1', type: 'int', variablesReference: 0 },
    ]);
    fixture.detectChanges();

    // Initially just the scope row.
    expect(c.variableRows().map((r) => r.id)).toEqual(['scope:0']);

    // Expanding the scope fetches and splices in its variables.
    c.onVariableClick(c.variableRows()[0]);
    await flush();
    fixture.detectChanges();

    const rows: readonly TreeRow[] = c.variableRows();
    expect(rows).toHaveLength(2);
    expect(c.variableOf(rows[1])).toMatchObject({ kind: 'variable' });
  });

  it('watch_addEvaluatesAndRemoveClears', async () => {
    session.currentFrame.set(1);
    session.evaluations.set('x + 1', { result: '42', variablesReference: 0, failed: false });
    fixture.detectChanges();

    c.newWatch.set('x + 1');
    c.addWatch();
    await flush();

    expect(c.watchExpressions()).toEqual(['x + 1']);
    expect(c.watchResult('x + 1')?.result).toBe('42');

    c.removeWatch('x + 1');
    expect(c.watchExpressions()).toEqual([]);
    expect(c.watchResult('x + 1')).toBeUndefined();
  });

  it('toolbarControls_forwardToTheSession', () => {
    c.onContinue();
    c.onStepOver();
    c.onStepInto();
    c.onStepOut();
    c.onStop();
    expect(session.commands).toEqual(['continue', 'stepOver', 'stepIn', 'stepOut', 'stop']);
  });
});
