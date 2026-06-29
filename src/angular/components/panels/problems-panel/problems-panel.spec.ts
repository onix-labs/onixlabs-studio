import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockPanel } from '../../../services/dock/dock-panel';
import {
  Diagnostic,
  Diagnostics,
  DiagnosticsProvider,
} from '../../../services/diagnostics/diagnostics';
import { Documents } from '../../../services/documents/documents';
import { Icon } from '@shared/angular/icons/icon';

import { ProblemsPanel } from './problems-panel';

/**
 * A provider whose single contribution the test pushes immediately on connect.
 */
class StaticProvider implements DiagnosticsProvider {
  public readonly id: string = 'static';

  public constructor(private readonly diagnostics: readonly Diagnostic[]) {}

  public connect(onChange: (diagnostics: readonly Diagnostic[]) => void): () => void {
    onChange(this.diagnostics);
    return (): void => undefined;
  }
}

describe('ProblemsPanel', () => {
  let component: ProblemsPanel;
  let fixture: ComponentFixture<ProblemsPanel>;

  const panel: DockPanel = {
    id: 'errors',
    title: 'Error List',
    icon: Icon.PROBLEMS,
    role: 'tool',
    component: ProblemsPanel,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProblemsPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(ProblemsPanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panel', panel);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenNoDiagnostics_showsTheEmptyState', () => {
    fixture.detectChanges();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No problems detected');
  });

  it('render_whenDiagnosticsReported_listsTheMessage', () => {
    TestBed.inject(Documents).ensure('doc-1');
    const diagnostics: Diagnostics = TestBed.inject(Diagnostics);
    diagnostics.register(
      new StaticProvider([
        {
          file: 'main.ts',
          message: 'Cannot find name',
          severity: 'error',
          line: 3,
          column: 5,
          source: 'typescript',
          documentId: 'doc-1',
          path: '/ws/main.ts',
        },
      ]),
    );
    fixture.detectChanges();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Cannot find name');
    expect(text).toContain('main.ts:3:5');
  });
});
