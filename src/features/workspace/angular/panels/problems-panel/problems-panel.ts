import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import {
  Diagnostic,
  DiagnosticSeverity,
  Diagnostics,
} from '@shared/angular/services/diagnostics/diagnostics';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Button } from '@shared/angular/components/forms/button/button';

/**
 * Maps each severity to its icon.
 */
const SEVERITY_ICONS: Readonly<Record<DiagnosticSeverity, Icon>> = {
  error: Icon.ERROR,
  warning: Icon.WARNING,
  info: Icon.INFO,
  hint: Icon.HINT,
};

/**
 * The severity filter selection: everything, or only one severity.
 */
type SeverityFilter = 'all' | DiagnosticSeverity;

/**
 * The source value used for "all sources" in the source filter.
 */
const ALL_SOURCES: string = '';

/**
 * A severity filter option shown as a toggle button in the tool-strip.
 */
interface SeverityOption {
  /**
   * The filter value this button selects.
   */
  readonly value: SeverityFilter;

  /**
   * The button label.
   */
  readonly label: string;

  /**
   * The button icon.
   */
  readonly icon: Icon;
}

/**
 * The severity filter options shown as toggle buttons in the tool-strip.
 */
const SEVERITY_OPTIONS: readonly SeverityOption[] = [
  { value: 'all', label: 'Everything', icon: Icon.LIST_ALL },
  { value: 'error', label: 'Errors', icon: Icon.ERROR },
  { value: 'warning', label: 'Warnings', icon: Icon.WARNING },
];

/**
 * Renders the aggregated {@link Diagnostics} as the body of the Problems (Error List) dock panel: a
 * tool-strip that filters by severity and source over a severity-sorted list of file/line/message rows,
 * with an error/warning summary. The dock chrome supplies the title bar. Fed uniformly by every
 * provider behind the {@link Diagnostics} seam (Monaco markers, each language server, build problems)
 * with no per-language special-casing.
 */
@Component({
  selector: 'app-problems-panel',
  imports: [Button, AppIcon, Dropdown, PanelToolbar],
  templateUrl: './problems-panel.html',
  styleUrl: './problems-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProblemsPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the severity filter options rendered as toggle buttons.
   */
  protected readonly severityOptions: readonly SeverityOption[] = SEVERITY_OPTIONS;

  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet, which sets it on
   * every projected panel component; unused here because the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets the diagnostics aggregate rendered by this panel.
   */
  public readonly diagnostics: Diagnostics = inject(Diagnostics);

  /**
   * Holds the file opener used to activate the document a diagnostic belongs to.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the editor registry used to reveal the diagnostic's line in its editor.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the selected severity filter.
   */
  protected readonly severity: WritableSignal<SeverityFilter> = signal<SeverityFilter>('all');

  /**
   * Holds the selected source filter, or {@link ALL_SOURCES} for every source.
   */
  protected readonly source: WritableSignal<string> = signal<string>(ALL_SOURCES);

  /**
   * Gets the distinct diagnostic sources as dropdown options, prefixed with an "all sources" entry.
   * Hidden by the template when only one source is present.
   */
  protected readonly sourceOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => {
      const sources: string[] = [
        ...new Set<string>(
          this.diagnostics
            .all()
            .map((diagnostic: Diagnostic): string => diagnostic.source)
            .filter((value: string): boolean => value.length > 0),
        ),
      ].sort((a: string, b: string): number => a.localeCompare(b));
      return [
        { value: ALL_SOURCES, label: 'All sources' },
        ...sources.map((value: string): DropdownOption => ({ value, label: value })),
      ];
    },
  );

  /**
   * Gets the diagnostics after applying the severity and source filters.
   */
  protected readonly filtered: Signal<readonly Diagnostic[]> = computed(
    (): readonly Diagnostic[] => {
      const severity: SeverityFilter = this.severity();
      const source: string = this.source();
      return this.diagnostics
        .all()
        .filter(
          (diagnostic: Diagnostic): boolean =>
            (severity === 'all' || diagnostic.severity === severity) &&
            (source === ALL_SOURCES || diagnostic.source === source),
        );
    },
  );

  /**
   * Selects a severity filter.
   * @param value The chosen filter value.
   */
  protected selectSeverity(value: SeverityFilter): void {
    this.severity.set(value);
  }

  /**
   * Selects a source filter.
   * @param value The chosen source, or {@link ALL_SOURCES}.
   */
  protected selectSource(value: string): void {
    this.source.set(value);
  }

  /**
   * Resolves the icon for a diagnostic's severity.
   * @param severity The diagnostic severity.
   * @returns Returns the severity icon.
   */
  public iconFor(severity: DiagnosticSeverity): Icon {
    return SEVERITY_ICONS[severity];
  }

  /**
   * Reveals a diagnostic in the editor: opens its file (so a build problem against a file that is not
   * yet open still opens it), then jumps the editor to the reported line and column when the document
   * is known. A diagnostic with neither a path nor an open document cannot be revealed.
   * @param diagnostic The diagnostic to reveal.
   */
  public reveal(diagnostic: Diagnostic): void {
    if (diagnostic.path !== null) {
      void this.fileOpener.openPath(diagnostic.path);
    }
    if (diagnostic.documentId !== null) {
      this.editors.requestReveal(diagnostic.documentId, diagnostic.line, diagnostic.column);
    }
  }

  /**
   * Builds a stable tracking key for a diagnostic row.
   * @param index The row index.
   * @param diagnostic The diagnostic.
   * @returns Returns the tracking key.
   */
  public trackBy(index: number, diagnostic: Diagnostic): string {
    return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${diagnostic.message}`;
  }
}
