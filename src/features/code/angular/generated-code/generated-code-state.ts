import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import {
  buildContent,
  DisasmContent,
  EMPTY_CONTENT,
} from '@shared/angular/services/decoders/listing-content';
import { CodeListing, ListingSection } from '@shared/api/code-listing';
import { JitCaptureResult, JitTier } from '@shared/api/jit-capture';
import { Decoders } from '@shared/angular/services/decoders/decoders';
import { Settings } from '@shared/angular/services/settings/settings';
import { GeneratedCode, GeneratedCodeResolver } from './generated-code';

/**
 * What a code tab's file compiles to, as its generated-code panel shows it. Provided per tab, so a decoded
 * listing — and a JIT capture, which runs the program — outlives the panel: the dock draws a panel afresh
 * whenever it moves or comes back from behind another tab.
 *
 * Nothing is read until a panel first asks, through {@link show}.
 */
@Service()
export class GeneratedCodeState {
  /**
   * Holds the resolver that turns a source path into decoded output.
   */
  private readonly resolver: GeneratedCodeResolver = inject(GeneratedCodeResolver);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the settings, read for the view the panel starts on.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the shared decoder client, used here for the JIT capture.
   */
  private readonly decoders: Decoders = inject(Decoders);

  /**
   * Holds the resolved outcome, or null before the first resolution completes.
   */
  public readonly state: WritableSignal<GeneratedCode | null> = signal<GeneratedCode | null>(null);

  /**
   * Holds whether a resolution is in flight, so the panel says so rather than showing a stale answer.
   */
  public readonly loading: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the rendered listing text and its line map.
   */
  public readonly content: Signal<DisasmContent> = computed((): DisasmContent => {
    if (this.mode() === 'jit') {
      const captured: JitCaptureResult | null = this.jit();
      return captured?.ok === true ? buildContent(captured.listing) : EMPTY_CONTENT;
    }
    const result: GeneratedCode | null = this.state();
    return result?.kind === 'listing' ? buildContent(result.listing) : EMPTY_CONTENT;
  });

  /**
   * Holds the JIT capture's failure text, when the last capture produced none.
   */
  public readonly jitError: Signal<string | null> = computed((): string | null => {
    const captured: JitCaptureResult | null = this.jit();
    return captured === null || captured.ok ? null : captured.error;
  });

  /**
   * Holds whether the captured program had to be stopped before it exited.
   */
  public readonly jitStopped: Signal<boolean> = computed((): boolean => {
    const captured: JitCaptureResult | null = this.jit();
    return captured !== null && captured.ok && captured.stopped;
  });

  /**
   * Holds which listing the panel is showing: what the compiler produced, or what the JIT did. Starts
   * on Generated Code Default View; the panel's own switch changes it from there.
   */
  public readonly mode: WritableSignal<'static' | 'jit'> = signal<'static' | 'jit'>(
    this.settings.get('textEditor.generatedCodeView'),
  );

  /**
   * Holds the optimisation tier the JIT capture asks for. A control rather than a setting: the same
   * method is markedly different code at each tier.
   */
  public readonly tier: WritableSignal<JitTier> = signal<JitTier>('full-opts');

  /**
   * Holds the JIT capture's outcome, or null before one has run for this file.
   */
  public readonly jit: WritableSignal<JitCaptureResult | null> = signal<JitCaptureResult | null>(
    null,
  );

  /**
   * Holds whether a JIT capture is running, which takes seconds rather than milliseconds because it
   * runs the program.
   */
  public readonly capturing: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the source file last resolved, or undefined before any was.
   */
  private shown: string | null | undefined = undefined;

  /**
   * Holds the resolution token, so an answer for a file the user has already navigated away from is
   * discarded rather than shown against the wrong source.
   */
  private token: number = 0;

  /**
   * Shows the generated code of a source file, reading the build output unless that file's is already
   * held.
   * @param path The source file, or null when there is none.
   */
  public show(path: string | null): void {
    if (path === this.shown) {
      return;
    }
    this.shown = path;
    void this.load(path);
  }

  /**
   * Switches between the compiler's output and the JIT's, capturing on first switch.
   * @param mode The mode to show.
   */
  public setMode(mode: 'static' | 'jit'): void {
    this.mode.set(mode);
    if (mode === 'jit' && this.jit() === null) {
      void this.captureJit();
    }
  }

  /**
   * Re-runs the JIT capture, for the tier control and the retry button.
   * @param tier The tier to ask for.
   */
  public setTier(tier: JitTier): void {
    this.tier.set(tier);
    void this.captureJit();
  }

  /**
   * Runs the program and captures what the JIT generated for this file's methods.
   *
   * Captures everything the JIT compiled and then narrows to the methods this file produced, taken
   * from the static listing — the JIT names methods its own way, and matching on those names is more
   * reliable than trying to express the file's methods as a JitDisasm pattern.
   */
  private async captureJit(): Promise<void> {
    const result: GeneratedCode | null = this.state();
    if (result?.kind !== 'listing') {
      return;
    }
    this.capturing.set(true);
    try {
      const captured: JitCaptureResult = await this.decoders.captureJit(
        result.artifactPath,
        '*',
        this.tier(),
      );
      this.jit.set(
        captured.ok
          ? { ...captured, listing: narrowToMethods(captured.listing, result.listing) }
          : captured,
      );
    } finally {
      this.capturing.set(false);
    }
  }

  /**
   * Resolves and decodes the generated code for a source file.
   * @param path The source file, or null when there is none.
   */
  private async load(path: string | null): Promise<void> {
    if (path === null) {
      this.state.set(null);
      return;
    }
    const current: number = (this.token += 1);
    this.jit.set(null);
    this.loading.set(true);
    try {
      const result: GeneratedCode = await this.resolver.resolve(path);
      if (current === this.token) {
        this.state.set(result);
        this.log.debug('code.generated', `Generated code for '${path}': ${result.kind}`);
        // A panel on the JIT view captures as its listing arrives, as switching to it would.
        if (this.mode() === 'jit' && result.kind === 'listing') {
          void this.captureJit();
        }
      }
    } finally {
      if (current === this.token) {
        this.loading.set(false);
      }
    }
  }
}

/**
 * Narrows a JIT listing to the methods a static listing says came from the open file.
 *
 * The JIT names a method `Type:Method(args):ret` while the static listing names it `Type.Method`, so
 * they are compared on the method name alone. Coarse, but the alternative — trusting the JIT to have
 * compiled only what was asked for — is worse: a JitDisasm pattern matches by substring and would
 * quietly include unrelated methods.
 * @param jit The captured JIT listing.
 * @param staticListing The static listing for the open file.
 * @returns Returns the narrowed listing, or the whole capture when nothing matched.
 */
function narrowToMethods(jit: CodeListing, staticListing: CodeListing): CodeListing {
  const wanted: ReadonlySet<string> = new Set<string>(
    staticListing.sections.map((section: ListingSection): string => methodName(section.title)),
  );
  const matched: readonly ListingSection[] = jit.sections.filter(
    (section: ListingSection): boolean => wanted.has(methodName(section.title)),
  );
  // Nothing matched means the JIT compiled none of this file's methods during the run — which is
  // itself worth showing, so the whole capture is kept rather than an empty listing.
  return matched.length === 0 ? jit : { ...jit, sections: matched };
}

/**
 * Extracts a bare method name from either naming convention.
 * @param title The section title.
 * @returns Returns the method name.
 */
function methodName(title: string): string {
  const withoutArgs: string = title.split('(')[0];
  const parts: readonly string[] = withoutArgs.split(/[.:]/);
  return parts[parts.length - 1] ?? withoutArgs;
}
