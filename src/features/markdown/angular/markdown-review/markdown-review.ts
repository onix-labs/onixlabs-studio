import {
  computed,
  effect,
  inject,
  Service,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { MarkdownPanels } from '@features/markdown/angular/markdown-panels/markdown-panels';
import { SpellingProbe } from '@shared/api/spelling-channels';
import { Log } from '@shared/angular/services/log/log';
import { Spelling } from '@shared/angular/services/spelling/spelling';
import { Settings } from '@shared/angular/services/settings/settings';
import { analyzeMarkdown, ReviewRuleOptions } from './review-rules';
import {
  DictionaryLoader,
  loadEnglishWords,
  ProbeChecker,
  SpellChecker,
  WordChecker,
} from './review-spell';
import { applyReviewEdits, changedRange, isOffsetReplaced, mapOffset } from './review-edits';
import {
  ReviewCounts,
  ReviewEdit,
  ReviewIssue,
  ReviewKind,
  ReviewSession,
  ReviewUndoStep,
} from './review-types';

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
 * One occurrence of an issue left alone by Ignore Once.
 */
interface IgnoredOccurrence {
  /**
   * Gets the issue's ignore signature.
   */
  readonly signature: string;

  /**
   * Gets the occurrence's start offset in the source.
   */
  readonly start: number;
}

/**
 * Runs spelling plus curated style/grammar checks over the active markdown document and walks the
 * Review panel through the findings one at a time. The active editor registers a {@link ReviewSession}
 * so the service can read the live source, apply accepted suggestions, and reveal flagged ranges.
 *
 * The current issue is held by its position in the source rather than by its id, because ids carry
 * offsets and every edit moves them. Each edit, the panel's or the user's, carries that position and
 * the Ignore Once occurrences along with it, so the walk resumes at the next issue after an action.
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
   * Holds the settings saying which rules review runs.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets which of the curated rules run.
   */
  private readonly ruleOptions: Signal<ReviewRuleOptions> = computed((): ReviewRuleOptions => ({
    repeatedWord: this.settings.get('markdownEditor.reviewRepeatedWord'),
    passiveVoice: this.settings.get('markdownEditor.reviewPassiveVoice'),
    articleAgreement: this.settings.get('markdownEditor.reviewArticleAgreement'),
    weakIntensifier: this.settings.get('markdownEditor.reviewWeakIntensifier'),
    serialComma: this.settings.get('markdownEditor.reviewSerialComma'),
  }));

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
   * Holds the source the positions below were last valid for, or null before the first analysis.
   */
  private trackedSource: string | null = null;

  /**
   * Holds the ignored issue signatures (session only), from Ignore All.
   */
  private readonly ignoredState: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the occurrences left alone by Ignore Once, until the active document changes.
   */
  private readonly ignoredOnceState: WritableSignal<readonly IgnoredOccurrence[]> = signal<
    readonly IgnoredOccurrence[]
  >([]);

  /**
   * Holds the source offset the walk has reached.
   */
  private readonly cursorState: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the id of the issue chosen at the cursor, which picks between issues sharing an offset, or
   * null once an edit has made ids stale.
   */
  private readonly chosenIdState: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the actions Undo can take back, most recent last.
   */
  private readonly undoStepsState: WritableSignal<readonly ReviewUndoStep[]> = signal<
    readonly ReviewUndoStep[]
  >([]);

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
      const ignoredOnce: readonly IgnoredOccurrence[] = this.ignoredOnceState();
      return this.allIssuesState().filter((issue: ReviewIssue): boolean => {
        const signature: string = ignoreSignature(issue);
        return (
          !ignored.has(signature) &&
          !ignoredOnce.some(
            (occurrence: IgnoredOccurrence): boolean =>
              occurrence.signature === signature && occurrence.start === issue.start,
          )
        );
      });
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
   * Gets the issue the walk is on: the one chosen, or else the first at or after the cursor, wrapping
   * to the start so issues skipped earlier are not lost. Null once nothing is left.
   */
  public readonly current: Signal<ReviewIssue | null> = computed((): ReviewIssue | null => {
    const issues: readonly ReviewIssue[] = this.issues();
    const chosenId: string | null = this.chosenIdState();
    const cursor: number = this.cursorState();
    return (
      issues.find((issue: ReviewIssue): boolean => issue.id === chosenId) ??
      issues.find((issue: ReviewIssue): boolean => issue.start >= cursor) ??
      issues[0] ??
      null
    );
  });

  /**
   * Gets the current issue's one-based position in the panel's issues, or zero when there is none.
   */
  public readonly position: Signal<number> = computed((): number => {
    const current: ReviewIssue | null = this.current();
    return current === null ? 0 : this.issues().indexOf(current) + 1;
  });

  /**
   * Gets whether there is a review action to undo.
   */
  public readonly canUndo: Signal<boolean> = computed(
    (): boolean => this.undoStepsState().length > 0,
  );

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
      this.ruleOptions();
      if (!visible) {
        this.session?.clearHighlight();
      } else if (this.session !== null) {
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
    this.trackedSource = null;
    this.ignoredOnceState.set([]);
    this.undoStepsState.set([]);
    this.chosenIdState.set(null);
    this.cursorState.set(0);
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
   * Sets the active filter. The walk carries on from where it is, among the issues the filter leaves.
   * @param filter The filter to apply.
   */
  public setFilter(filter: ReviewFilter): void {
    this.log.debug('markdown.review', 'Review filter changed', { filter });
    this.filterState.set(filter);
    this.chosenIdState.set(null);
    this.revealCurrent();
  }

  /**
   * Re-runs the analysis on the active document.
   */
  public async refresh(): Promise<void> {
    this.log.info('markdown.review', 'Review analysis refresh requested');
    await this.ensureAnalyzed();
  }

  /**
   * Moves to the issue before the current one.
   */
  public previous(): void {
    this.moveBy(-1);
  }

  /**
   * Moves to the issue after the current one.
   */
  public next(): void {
    this.moveBy(1);
  }

  /**
   * Applies a suggestion by replacing the flagged range in the active document, then moves on.
   * @param issue The issue.
   * @param suggestion The replacement text.
   */
  public applySuggestion(issue: ReviewIssue, suggestion: string): void {
    this.log.info('markdown.review', 'Applied suggestion', {
      kind: issue.kind,
      word: issue.word,
      suggestion,
    });
    this.applyToIssues(issue, [issue], suggestion);
  }

  /**
   * Applies a suggestion to every occurrence of the issue's exact word under the same rule, as one
   * undoable step, then moves on. Occurrences left alone by Ignore Once stay as they are.
   * @param issue The issue.
   * @param suggestion The replacement text.
   */
  public applySuggestionToAll(issue: ReviewIssue, suggestion: string): void {
    const matching: readonly ReviewIssue[] = this.activeIssues().filter(
      (candidate: ReviewIssue): boolean =>
        candidate.kind === issue.kind &&
        candidate.ruleName === issue.ruleName &&
        candidate.word === issue.word,
    );
    this.log.info('markdown.review', 'Applied suggestion to all', {
      kind: issue.kind,
      word: issue.word,
      suggestion,
      count: matching.length,
    });
    this.applyToIssues(issue, matching, suggestion);
  }

  /**
   * Adds the issue's word to the personal dictionary, then moves on.
   * @param issue The issue.
   */
  public addToDictionary(issue: ReviewIssue): void {
    this.log.info('markdown.review', 'Added word to dictionary', { word: issue.word });
    if (this.spelling.addWord(issue.word)) {
      this.pushUndo({
        start: issue.start,
        sourceAfter: null,
        revert: (): void => this.spelling.removeWord(issue.word),
      });
    }
    this.settle(issue.start);
  }

  /**
   * Ignores this one occurrence of an issue, then moves on.
   * @param issue The issue.
   */
  public ignoreOnce(issue: ReviewIssue): void {
    this.log.info('markdown.review', 'Ignored issue once', { kind: issue.kind, word: issue.word });
    const signature: string = ignoreSignature(issue);
    this.ignoredOnceState.update(
      (occurrences: readonly IgnoredOccurrence[]): readonly IgnoredOccurrence[] => [
        ...occurrences,
        { signature, start: issue.start },
      ],
    );
    this.pushUndo({
      start: issue.start,
      sourceAfter: null,
      revert: (start: number): void =>
        this.ignoredOnceState.update(
          (occurrences: readonly IgnoredOccurrence[]): readonly IgnoredOccurrence[] =>
            occurrences.filter(
              (occurrence: IgnoredOccurrence): boolean =>
                occurrence.signature !== signature || occurrence.start !== start,
            ),
        ),
    });
    this.settle(issue.start);
  }

  /**
   * Ignores an issue (all instances of its word and rule) for the session, then moves on.
   * @param issue The issue.
   */
  public ignoreAll(issue: ReviewIssue): void {
    this.log.info('markdown.review', 'Ignored all of issue', {
      kind: issue.kind,
      word: issue.word,
    });
    const signature: string = ignoreSignature(issue);
    const next: Set<string> = new Set<string>(this.ignoredState());
    next.add(signature);
    this.ignoredState.set(next);
    this.pushUndo({
      start: issue.start,
      sourceAfter: null,
      revert: (): void => {
        const remaining: Set<string> = new Set<string>(this.ignoredState());
        remaining.delete(signature);
        this.ignoredState.set(remaining);
      },
    });
    this.settle(issue.start);
  }

  /**
   * Takes back the most recent review action and returns to the issue it was taken on.
   */
  public undo(): void {
    if (this.session !== null) {
      this.dropStaleUndo(this.session.getSource());
    }
    const steps: readonly ReviewUndoStep[] = this.undoStepsState();
    const step: ReviewUndoStep | undefined = steps[steps.length - 1];
    if (step === undefined) {
      return;
    }
    this.undoStepsState.set(steps.slice(0, -1));
    step.revert(step.start);
    this.log.info('markdown.review', 'Undid review action');
    this.settle(step.start);
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
    this.revealCurrent();
  }

  /**
   * Analyses the active document's source into issues, and keeps the current issue highlighted. Runs
   * untracked, as an effect may be what called it and it writes what the current issue is read from.
   */
  private analyze(): void {
    untracked((): void => {
      const checker: WordChecker | null = this.appChecker() ?? this.bundled;
      if (this.session === null || checker === null) {
        this.allIssuesState.set([]);
        return;
      }
      const source: string = this.session.getSource();
      this.trackSource(source);
      this.dropStaleUndo(source);
      this.allIssuesState.set(
        analyzeMarkdown(source, checker, this.userDictionary(), this.ruleOptions()),
      );
      const current: ReviewIssue | null = this.current();
      if (current === null) {
        this.session.clearHighlight();
      } else {
        this.session.highlight(current);
      }
    });
  }

  /**
   * Moves the walk by a number of issues, staying put at either end of the list.
   * @param delta The number of issues to move by.
   */
  private moveBy(delta: number): void {
    const target: ReviewIssue | undefined = this.issues()[this.position() - 1 + delta];
    if (target === undefined) {
      return;
    }
    this.cursorState.set(target.start);
    this.chosenIdState.set(target.id);
    this.reveal(target);
  }

  /**
   * Replaces the given issues' flagged text in the active document. Nothing is applied if the document
   * has moved on from what the panel shows, which it can in the moment before a re-analysis, so an
   * offset that has gone stale never overwrites the wrong text.
   * @param issue The issue the action was taken on, which the walk continues from.
   * @param targets The issues to replace.
   * @param suggestion The replacement text.
   */
  private applyToIssues(
    issue: ReviewIssue,
    targets: readonly ReviewIssue[],
    suggestion: string,
  ): void {
    if (this.session === null) {
      return;
    }
    const source: string = this.session.getSource();
    this.trackSource(source);
    const isCurrent: boolean = targets.every(
      (target: ReviewIssue): boolean => source.slice(target.start, target.end) === target.word,
    );
    if (!isCurrent) {
      this.log.info('markdown.review', 'Suggestion not applied, the document has changed');
      this.analyze();
      this.revealCurrent();
      return;
    }
    const edits: readonly ReviewEdit[] = targets.map((target: ReviewIssue): ReviewEdit => ({
      start: target.start,
      end: target.end,
      replacement: suggestion,
    }));
    this.cursorState.set(issue.start);
    this.session.applyEdits(edits);
    this.shiftPositions(edits);
    this.trackedSource = applyReviewEdits(source, edits);
    const session: ReviewSession = this.session;
    this.pushUndo({
      start: mapOffset(issue.start, edits),
      sourceAfter: session.getSource(),
      revert: (): void => session.undo(),
    });
    this.settle(this.cursorState());
  }

  /**
   * Re-analyses and moves to the issue at or after an offset, revealing it.
   * @param start The offset to carry on from.
   */
  private settle(start: number): void {
    this.analyze();
    this.chosenIdState.set(null);
    this.cursorState.set(start);
    this.revealCurrent();
  }

  /**
   * Reveals the current issue, or clears the highlight when none is left.
   */
  private revealCurrent(): void {
    untracked((): void => {
      const current: ReviewIssue | null = this.current();
      if (current === null) {
        this.session?.clearHighlight();
      } else {
        this.reveal(current);
      }
    });
  }

  /**
   * Records an action Undo can take back.
   * @param step The undo step.
   */
  private pushUndo(step: ReviewUndoStep): void {
    this.undoStepsState.update((steps: readonly ReviewUndoStep[]): readonly ReviewUndoStep[] => [
      ...steps,
      step,
    ]);
  }

  /**
   * Discards edits at the top of the undo list that something else has since built on: the editor's
   * history would undo that newer change instead.
   * @param source The current source.
   */
  private dropStaleUndo(source: string): void {
    const steps: ReviewUndoStep[] = [...this.undoStepsState()];
    let top: ReviewUndoStep | undefined = steps[steps.length - 1];
    while (top !== undefined && top.sourceAfter !== null && top.sourceAfter !== source) {
      steps.pop();
      top = steps[steps.length - 1];
    }
    this.undoStepsState.set(steps);
  }

  /**
   * Carries the tracked positions through whatever changed in the source since they were last valid.
   * @param source The current source.
   */
  private trackSource(source: string): void {
    const edit: ReviewEdit | null =
      this.trackedSource === null ? null : changedRange(this.trackedSource, source);
    if (edit !== null) {
      this.shiftPositions([edit]);
    }
    this.trackedSource = source;
  }

  /**
   * Carries the cursor, Ignore Once occurrences, and undo steps through edits. An occurrence whose text
   * was replaced has gone, so its ignore goes too.
   * @param edits The edits.
   */
  private shiftPositions(edits: readonly ReviewEdit[]): void {
    this.cursorState.update((cursor: number): number => mapOffset(cursor, edits));
    this.chosenIdState.set(null);
    this.ignoredOnceState.update(
      (occurrences: readonly IgnoredOccurrence[]): readonly IgnoredOccurrence[] =>
        occurrences
          .filter(
            (occurrence: IgnoredOccurrence): boolean => !isOffsetReplaced(occurrence.start, edits),
          )
          .map((occurrence: IgnoredOccurrence): IgnoredOccurrence => ({
            ...occurrence,
            start: mapOffset(occurrence.start, edits),
          })),
    );
    this.undoStepsState.update((steps: readonly ReviewUndoStep[]): readonly ReviewUndoStep[] =>
      steps.map((step: ReviewUndoStep): ReviewUndoStep => ({
        ...step,
        start: mapOffset(step.start, edits),
      })),
    );
  }
}
