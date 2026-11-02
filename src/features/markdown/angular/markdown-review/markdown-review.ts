import { computed, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { MarkdownPanels } from '@features/markdown/angular/markdown-panels/markdown-panels';
import { SpellingProbe } from '@shared/api/spelling-channels';
import { Log } from '@shared/angular/services/log/log';
import { Spelling } from '@shared/angular/services/spelling/spelling';
import { analyzeMarkdown } from './review-rules';
import {
  DictionaryLoader,
  loadEnglishWords,
  ProbeChecker,
  SpellChecker,
  WordChecker,
} from './review-spell';
import { ReviewCounts, ReviewIssue, ReviewKind, ReviewSession } from './review-types';

/**
 * The active review filter: a specific category, or all.
 */
export type ReviewFilter = ReviewKind | 'all';

/**
 * Delay in milliseconds before re-analysing after the document changes, coalescing rapid edits.
 */
const ANALYZE_DEBOUNCE: number = 400;

/**
 * Builds the ignore signature for an issue (category, rule, then lowercased word), so ignoring
 * persists across re-analysis and edits.
 * @param issue The issue.
 * @returns Returns the signature.
 */
function ignoreSignature(issue: ReviewIssue): string {
  return `${issue.kind}:${issue.ruleName}:${issue.word.toLowerCase()}`;
}

/**
 * Runs spelling plus curated style/grammar checks over the active markdown document and exposes the
 * findings, counts, and a filter for the Review panel. The active editor registers a
 * {@link ReviewSession} so the service can read the live source, apply accepted suggestions, and
 * reveal flagged ranges.
 *
 * Spelling is checked by Studio's own spell checker while Spell Checking is on, so review follows the
 * chosen languages (the system's on macOS), exactly as text boxes do; with it off, or outside Electron,
 * review falls back to the bundled English list, loaded (~3 MB) the first time it is needed. Words
 * added to the dictionary go to the shared personal dictionary in Settings; ignoring is session-only.
 */
@Service()
export class Review {
  /**
   * Holds the tool-panel registry, used to detect when the Review panel is visible.
   */
  private readonly panels: MarkdownPanels = inject(MarkdownPanels);

  /**
   * Holds the logging client for surfacing dictionary persistence failures to the audit.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the app's spell checking: its checker and the shared personal dictionary.
   */
  private readonly spelling: Spelling = inject(Spelling);

  /**
   * Holds the dictionary loader, overridable in tests with a small word set.
   */
  private dictionaryLoader: DictionaryLoader = loadEnglishWords;

  /**
   * Holds the bundled English checker once its dictionary has loaded, or null beforehand.
   */
  private bundled: SpellChecker | null = null;

  /**
   * Holds a value indicating whether the dictionary load has started (guards re-entrancy).
   */
  private loadStarted: boolean = false;

  /**
   * Holds the session registered by the active editor, or null when no markdown editor is active.
   */
  private session: ReviewSession | null = null;

  /**
   * Holds the pending debounced re-analysis timer, or null when none is scheduled.
   */
  private analyzeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds whether a markdown editor is active (a session is registered).
   */
  private readonly hasSessionState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the dictionary is loaded and checks can run.
   */
  private readonly readyState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the shared personal dictionary, lowercased for matching.
   */
  private readonly userDictionary: Signal<ReadonlySet<string>> = computed(
    (): ReadonlySet<string> =>
      new Set<string>(this.spelling.words().map((word: string): string => word.toLowerCase())),
  );

  /**
   * Gets Studio's spell checker while Spell Checking is on, or null when review uses the bundled list.
   */
  private readonly appChecker: Signal<WordChecker | null> = computed((): WordChecker | null => {
    const probe: SpellingProbe | undefined = this.spelling.checker();
    return probe === undefined ? null : new ProbeChecker(probe);
  });

  /**
   * Holds the ignored issue signatures (session only).
   */
  private readonly ignoredState: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds all issues found in the active document (before ignore and filter).
   */
  private readonly allIssuesState: WritableSignal<readonly ReviewIssue[]> = signal<
    readonly ReviewIssue[]
  >([]);

  /**
   * Holds the active filter.
   */
  private readonly filterState: WritableSignal<ReviewFilter> = signal<ReviewFilter>('all');

  /**
   * Gets whether a markdown editor is active, so the panel can prompt to open a document.
   */
  public readonly hasSession: Signal<boolean> = this.hasSessionState.asReadonly();

  /**
   * Gets whether the dictionary is loaded.
   */
  public readonly ready: Signal<boolean> = this.readyState.asReadonly();

  /**
   * Gets the active filter.
   */
  public readonly filter: Signal<ReviewFilter> = this.filterState.asReadonly();

  /**
   * Gets the issues remaining after ignores, used for the counts.
   */
  private readonly activeIssues: Signal<readonly ReviewIssue[]> = computed(
    (): readonly ReviewIssue[] => {
      const ignored: ReadonlySet<string> = this.ignoredState();
      return this.allIssuesState().filter(
        (issue: ReviewIssue): boolean => !ignored.has(ignoreSignature(issue)),
      );
    },
  );

  /**
   * Gets the issues shown in the panel (active issues matching the filter).
   */
  public readonly issues: Signal<readonly ReviewIssue[]> = computed((): readonly ReviewIssue[] => {
    const filter: ReviewFilter = this.filterState();
    const active: readonly ReviewIssue[] = this.activeIssues();
    return filter === 'all'
      ? active
      : active.filter((issue: ReviewIssue): boolean => issue.kind === filter);
  });

  /**
   * Gets the issue counts per category for the filter chips.
   */
  public readonly counts: Signal<ReviewCounts> = computed((): ReviewCounts => {
    const active: readonly ReviewIssue[] = this.activeIssues();
    return {
      all: active.length,
      spelling: active.filter((issue: ReviewIssue): boolean => issue.kind === 'spelling').length,
      grammar: active.filter((issue: ReviewIssue): boolean => issue.kind === 'grammar').length,
      style: active.filter((issue: ReviewIssue): boolean => issue.kind === 'style').length,
    };
  });

  /**
   * Analyses the document when the Review panel becomes visible, and again whenever the checker or
   * the personal dictionary changes (a word added here, or in Settings).
   */
  public constructor() {
    effect((): void => {
      const visible: boolean = this.panels.active().has('review');
      this.hasSessionState();
      this.appChecker();
      this.userDictionary();
      if (visible && this.session !== null) {
        void this.ensureAnalyzed();
      }
    });
  }

  /**
   * Registers the active editor's review session, replacing any prior one, and re-analyses when the
   * Review panel is open.
   * @param session The session to register.
   */
  public registerSession(session: ReviewSession): void {
    this.session = session;
    this.hasSessionState.set(true);
    if (this.panels.active().has('review')) {
      void this.ensureAnalyzed();
    }
  }

  /**
   * Unregisters the given session if it is the current one, clearing the findings.
   * @param session The session to remove.
   */
  public unregisterSession(session: ReviewSession): void {
    if (this.session !== session) {
      return;
    }
    this.session = null;
    this.hasSessionState.set(false);
    this.allIssuesState.set([]);
  }

  /**
   * Schedules a debounced re-analysis after the active document changes, when the panel is open.
   */
  public notifySourceChanged(): void {
    if (!this.panels.active().has('review') || this.session === null) {
      return;
    }
    if (this.analyzeTimer !== null) {
      clearTimeout(this.analyzeTimer);
    }
    this.analyzeTimer = setTimeout((): void => {
      this.analyzeTimer = null;
      this.analyze();
    }, ANALYZE_DEBOUNCE);
  }

  /**
   * Sets the active filter.
   * @param filter The filter to apply.
   */
  public setFilter(filter: ReviewFilter): void {
    this.log.debug('markdown.review', 'Review filter changed', { filter });
    this.filterState.set(filter);
  }

  /**
   * Re-runs the analysis on the active document.
   */
  public async refresh(): Promise<void> {
    this.log.info('markdown.review', 'Review analysis refresh requested');
    await this.ensureAnalyzed();
  }

  /**
   * Applies a suggestion by replacing the flagged range in the active document, then re-analyses.
   * @param issue The issue.
   * @param suggestion The replacement text.
   */
  public applySuggestion(issue: ReviewIssue, suggestion: string): void {
    this.log.info('markdown.review', 'Applied suggestion', {
      kind: issue.kind,
      word: issue.word,
      suggestion,
    });
    this.session?.applyEdit(issue.start, issue.end, suggestion);
    this.analyze();
  }

  /**
   * Adds the issue's word to the personal dictionary and re-analyses.
   * @param issue The issue.
   */
  public addToDictionary(issue: ReviewIssue): void {
    this.log.info('markdown.review', 'Added word to dictionary', { word: issue.word });
    this.spelling.addWord(issue.word);
    this.analyze();
  }

  /**
   * Ignores an issue (all instances of its word and rule) for the session.
   * @param issue The issue.
   */
  public ignore(issue: ReviewIssue): void {
    this.log.info('markdown.review', 'Ignored issue', { kind: issue.kind, word: issue.word });
    const next: Set<string> = new Set<string>(this.ignoredState());
    next.add(ignoreSignature(issue));
    this.ignoredState.set(next);
  }

  /**
   * Reveals an issue in the editor.
   * @param issue The issue.
   */
  public reveal(issue: ReviewIssue): void {
    this.session?.reveal(issue);
  }

  /**
   * Overrides the dictionary loader. Intended for tests, which supply a small word set so the real
   * multi-megabyte dictionary is not imported.
   * @param loader The loader to use.
   */
  public setDictionaryLoader(loader: DictionaryLoader): void {
    this.dictionaryLoader = loader;
    this.bundled = null;
    this.loadStarted = false;
    this.readyState.set(false);
  }

  /**
   * Ensures a checker is ready — Studio's own, or the bundled list once loaded — then analyses the
   * active document.
   */
  private async ensureAnalyzed(): Promise<void> {
    if (this.appChecker() === null && this.bundled === null) {
      if (this.loadStarted) {
        return;
      }
      this.loadStarted = true;
      const words: readonly string[] = await this.dictionaryLoader();
      this.bundled = new SpellChecker(words);
    }
    this.readyState.set(true);
    this.analyze();
  }

  /**
   * Analyses the active document's source into issues.
   */
  private analyze(): void {
    const checker: WordChecker | null = this.appChecker() ?? this.bundled;
    if (this.session === null || checker === null) {
      this.allIssuesState.set([]);
      return;
    }
    this.allIssuesState.set(
      analyzeMarkdown(this.session.getSource(), checker, this.userDictionary()),
    );
  }
}
