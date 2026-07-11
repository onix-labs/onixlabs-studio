import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Settings, TextEditorSettings } from '@shared/angular/services/settings/settings';
import { ResolvedThemeMode, Theme } from '@shared/angular/services/theme/theme';
import { DiffView } from './diff-view';

/**
 * The text-editor settings the stubbed {@link Settings} hands out.
 */
const TEXT_EDITOR_SETTINGS: TextEditorSettings = {
  showLineNumbers: true,
  showMinimap: false,
  currentLineHighlight: 'outline',
  colorBrackets: false,
  wordWrap: false,
  stickyScroll: false,
  cursorBlinking: 'blink',
  cursorSmoothCaretAnimation: 'off',
  insertSpaces: true,
  tabSize: 2,
  fontFamily: 'monospace',
  fontSize: 13,
  lineHeight: 1.5,
  braceStyle: 'kr',
};

describe('DiffView', () => {
  let fixture: ComponentFixture<DiffView>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiffView],
      providers: [
        // The embedded DiffEditor asks this seam for the Monaco engine; reporting it as unavailable
        // keeps the pane inert (no editor is created) so the chrome can be exercised in jsdom.
        {
          provide: Monaco,
          useValue: {
            ensureLoaded: (): Promise<void> => Promise.resolve(),
            getMonaco: (): undefined => undefined,
            getDiffEditorOptions: (): Record<string, unknown> => ({}),
            getThemeName: (): string => 'studio-dark',
          },
        },
        { provide: Theme, useValue: { resolvedMode: signal<ResolvedThemeMode>('dark') } },
        {
          provide: Settings,
          useValue: { globalTextEditor: signal<TextEditorSettings>(TEXT_EDITOR_SETTINGS) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DiffView);
    host = fixture.nativeElement as HTMLElement;
  });

  it('render_whenNoFileSelected_showsTheEmptyState', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('.diff__header-path--muted')?.textContent).toContain(
      'No file selected',
    );
    expect(host.querySelector('.diff__empty')).not.toBeNull();
  });

  it('render_whenFileNameSet_showsThePathAndHidesTheEmptyState', async () => {
    fixture.componentRef.setInput('fileName', 'src/app/main.ts');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('.diff__header-path')?.textContent).toContain('src/app/main.ts');
    expect(host.querySelector('.diff__empty')).toBeNull();
  });

  it('render_whenStatusSet_showsTheChangeBadge', async () => {
    fixture.componentRef.setInput('fileName', 'src/app/main.ts');
    fixture.componentRef.setInput('status', 'modified');
    fixture.detectChanges();
    await fixture.whenStable();

    const badge: HTMLElement | null = host.querySelector<HTMLElement>('.diff__badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('modified');
    expect(badge!.classList).toContain('diff__badge--modified');
  });

  it('render_whenStatusUnknown_omitsTheBadge', async () => {
    fixture.componentRef.setInput('fileName', 'src/app/main.ts');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('.diff__badge')).toBeNull();
  });

  it('render_alwaysMountsTheSharedDiffEditorPane', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('app-diff-editor')).not.toBeNull();
  });
});
