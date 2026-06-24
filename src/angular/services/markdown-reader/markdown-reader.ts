import {
  computed,
  effect,
  inject,
  NgZone,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { EMPTY_DOCUMENT, ReadDocument, ReadParagraph, ReadWord } from './read-tokenize';
import { HighlightMode, ReadSession, VoiceOption } from './reader-types';

/**
 * Builds a speech utterance for the given text. Abstracted so tests can supply a fake without the
 * platform API.
 */
export type UtteranceFactory = (text: string) => SpeechSynthesisUtterance;

/**
 * Zero (counts, indices, comparisons).
 */
const ZERO: number = 0;

/**
 * One (increments and 1-based numbering).
 */
const ONE: number = 1;

/**
 * Default speech rate (1×, normal speed).
 */
const DEFAULT_RATE: number = 1;

/**
 * Approximate words spoken per minute at 1× rate, used to estimate timings.
 */
const WORDS_PER_MINUTE: number = 180;

/**
 * Seconds in a minute.
 */
const SECONDS_PER_MINUTE: number = 60;

/**
 * Width of the zero-padded seconds field in a time label.
 */
const TIME_PAD: number = 2;

/**
 * Lowest playback progress fraction.
 */
const MIN_PROGRESS: number = 0;

/**
 * Highest playback progress fraction.
 */
const MAX_PROGRESS: number = 1;

/**
 * Resolves the platform speech synthesiser, or null when the runtime does not provide one (such as a
 * headless test environment).
 * @returns Returns the speech controller, or null.
 */
function platformSynthesis(): SpeechSynthesis | null {
  return typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
}

/**
 * The default utterance factory, building a platform {@link SpeechSynthesisUtterance}.
 * @param text The text to speak.
 * @returns Returns the utterance.
 */
function platformUtterance(text: string): SpeechSynthesisUtterance {
  return new SpeechSynthesisUtterance(text);
}

/**
 * Formats a duration in seconds as `m:ss`.
 * @param totalSeconds The duration in seconds.
 * @returns Returns the formatted label.
 */
function formatTime(totalSeconds: number): string {
  const safe: number = Number.isFinite(totalSeconds) ? Math.max(ZERO, totalSeconds) : ZERO;
  const minutes: number = Math.floor(safe / SECONDS_PER_MINUTE);
  const seconds: number = Math.floor(safe % SECONDS_PER_MINUTE);
  return `${minutes}:${String(seconds).padStart(TIME_PAD, '0')}`;
}

/**
 * Drives karaoke-style read-along playback of the active document through the platform
 * {@link SpeechSynthesis} API: the active markdown editor publishes a tokenised model and registers a
 * {@link ReadSession}; the service speaks the document paragraph by paragraph and tracks the spoken
 * word/sentence so the session can highlight it in sync. Speed, voice, highlight mode, scrubbing, and
 * paragraph skipping are exposed as signals and methods for the Reader panel.
 */
@Service()
export class Reader {
  /**
   * Holds the Angular zone, used to re-enter change detection from speech callbacks.
   */
  private readonly zone: NgZone = inject(NgZone);

  /**
   * Holds the platform speech controller, or null when unavailable.
   */
  private synthesis: SpeechSynthesis | null = platformSynthesis();

  /**
   * Holds the factory used to build speech utterances.
   */
  private utteranceFactory: UtteranceFactory = platformUtterance;

  /**
   * Holds a generation counter that invalidates callbacks from cancelled utterances.
   */
  private generation: number = ZERO;

  /**
   * Holds the paragraph index of the utterance currently being spoken.
   */
  private activeParagraphIndex: number = ZERO;

  /**
   * Holds the character offset within the active paragraph at which the utterance began.
   */
  private baseCharOffset: number = ZERO;

  /**
   * Holds the index of the word currently highlighted.
   */
  private readonly currentWordState: WritableSignal<number> = signal<number>(ZERO);

  /**
   * Holds whether playback is active.
   */
  private readonly playingState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the playback rate.
   */
  private readonly rateState: WritableSignal<number> = signal<number>(DEFAULT_RATE);

  /**
   * Holds the highlight mode.
   */
  private readonly highlightState: WritableSignal<HighlightMode> = signal<HighlightMode>('word');

  /**
   * Holds the available voices.
   */
  private readonly voicesState: WritableSignal<readonly VoiceOption[]> = signal<readonly VoiceOption[]>(
    [],
  );

  /**
   * Holds the selected voice URI, or null when none is chosen.
   */
  private readonly selectedVoiceState: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the document published by the active markdown editor, or null when none is driving the
   * reader.
   */
  private readonly publishedDocState: WritableSignal<ReadDocument | null> =
    signal<ReadDocument | null>(null);

  /**
   * Holds the session registered by the active markdown editor, or null.
   */
  private readonly sessionState: WritableSignal<ReadSession | null> = signal<ReadSession | null>(
    null,
  );

  /**
   * Holds whether a read session is engaged (playing or paused mid-read), driving whether the
   * in-document highlight is shown.
   */
  private readonly engagedState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the read-along document, or an empty document when no editor is driving the reader.
   */
  private readonly document: Signal<ReadDocument> = computed(
    (): ReadDocument => this.publishedDocState() ?? EMPTY_DOCUMENT,
  );

  /**
   * Gets the current word index, clamped to the document's bounds.
   */
  private readonly clampedIndex: Signal<number> = computed((): number => {
    const total: number = this.document().totalWords;
    if (total === ZERO) {
      return ZERO;
    }
    return Math.min(Math.max(ZERO, this.currentWordState()), total - ONE);
  });

  /**
   * Gets whether there is a document available to read.
   */
  public readonly canRead: Signal<boolean> = computed(
    (): boolean => this.document().totalWords > ZERO,
  );

  /**
   * Gets whether playback is currently active.
   */
  public readonly isPlaying: Signal<boolean> = this.playingState.asReadonly();

  /**
   * Gets the current playback rate.
   */
  public readonly rate: Signal<number> = this.rateState.asReadonly();

  /**
   * Gets the current highlight mode.
   */
  public readonly highlightMode: Signal<HighlightMode> = this.highlightState.asReadonly();

  /**
   * Gets the available text-to-speech voices.
   */
  public readonly voices: Signal<readonly VoiceOption[]> = this.voicesState.asReadonly();

  /**
   * Gets the index of the word currently being read, clamped to the document bounds.
   */
  public readonly currentWordIndex: Signal<number> = this.clampedIndex;

  /**
   * Gets playback progress as a fraction between 0 and 1.
   */
  public readonly progress: Signal<number> = computed((): number => {
    const total: number = this.document().totalWords;
    if (total === ZERO) {
      return MIN_PROGRESS;
    }
    return Math.min(MAX_PROGRESS, this.clampedIndex() / total);
  });

  /**
   * Gets the estimated elapsed time label (`m:ss`).
   */
  public readonly elapsedLabel: Signal<string> = computed((): string =>
    formatTime(this.secondsFor(this.clampedIndex())),
  );

  /**
   * Gets the estimated total duration label (`m:ss`).
   */
  public readonly totalLabel: Signal<string> = computed((): string =>
    formatTime(this.secondsFor(this.document().totalWords)),
  );

  /**
   * Gets the currently selected voice, or null when none is chosen or available.
   */
  public readonly selectedVoice: Signal<VoiceOption | null> = computed((): VoiceOption | null => {
    const uri: string | null = this.selectedVoiceState();
    return this.voicesState().find((voice: VoiceOption): boolean => voice.uri === uri) ?? null;
  });

  /**
   * Loads the available voices and keeps the in-document highlight in sync with the spoken word.
   */
  public constructor() {
    this.loadVoices();
    if (this.synthesis !== null) {
      this.synthesis.onvoiceschanged = (): void => this.zone.run((): void => this.loadVoices());
    }
    effect((): void => {
      const session: ReadSession | null = this.sessionState();
      if (session === null) {
        return;
      }
      if (this.engagedState() && this.canRead()) {
        const index: number = this.clampedIndex();
        session.highlight(index, this.highlightState());
        session.revealWord(index);
      } else {
        session.clearHighlight();
      }
    });
  }

  /**
   * Registers the active editor's read session for in-document highlighting.
   * @param session The session to register.
   */
  public registerSession(session: ReadSession): void {
    this.sessionState.set(session);
  }

  /**
   * Unregisters the given session if it is the current one, stopping playback and clearing the
   * published document (no editor is driving the reader any more).
   * @param session The session to remove.
   */
  public unregisterSession(session: ReadSession): void {
    if (this.sessionState() !== session) {
      return;
    }
    this.stop();
    this.sessionState.set(null);
    this.publishedDocState.set(null);
  }

  /**
   * Publishes the read-along document derived from the rendered editor.
   * @param readDocument The rendered document model.
   */
  public setDocument(readDocument: ReadDocument): void {
    this.publishedDocState.set(readDocument);
  }

  /**
   * Starts, or resumes, playback from the current word.
   */
  public play(): void {
    if (this.synthesis === null || !this.canRead()) {
      return;
    }
    this.engagedState.set(true);
    if (this.synthesis.paused && this.synthesis.speaking) {
      this.synthesis.resume();
      this.playingState.set(true);
      return;
    }
    this.playingState.set(true);
    this.speakFrom(this.clampedIndex());
  }

  /**
   * Pauses playback, leaving the current position intact.
   */
  public pause(): void {
    if (this.synthesis?.speaking === true) {
      this.synthesis.pause();
    }
    this.playingState.set(false);
  }

  /**
   * Toggles between play and pause.
   */
  public toggle(): void {
    if (this.playingState()) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Stops playback and rewinds to the start of the document.
   */
  public stop(): void {
    this.generation += ONE;
    this.playingState.set(false);
    this.engagedState.set(false);
    this.synthesis?.cancel();
    this.currentWordState.set(ZERO);
  }

  /**
   * Jumps to the start of the next paragraph.
   */
  public skipForward(): void {
    const doc: ReadDocument = this.document();
    if (doc.totalWords === ZERO) {
      return;
    }
    const word: ReadWord = doc.words[this.clampedIndex()];
    const next: number = Math.min(word.paragraphIndex + ONE, doc.paragraphs.length - ONE);
    this.goToWord(doc.paragraphs[next].startWord);
  }

  /**
   * Jumps to the start of the current paragraph, or the previous one when already at the start.
   */
  public skipBackward(): void {
    const doc: ReadDocument = this.document();
    if (doc.totalWords === ZERO) {
      return;
    }
    const index: number = this.clampedIndex();
    const word: ReadWord = doc.words[index];
    const paragraph: ReadParagraph = doc.paragraphs[word.paragraphIndex];
    const target: number =
      index > paragraph.startWord
        ? paragraph.startWord
        : doc.paragraphs[Math.max(ZERO, word.paragraphIndex - ONE)].startWord;
    this.goToWord(target);
  }

  /**
   * Seeks to the given fraction of the document.
   * @param fraction A value between 0 and 1.
   */
  public seekToFraction(fraction: number): void {
    const doc: ReadDocument = this.document();
    if (doc.totalWords === ZERO) {
      return;
    }
    const clampedFraction: number = Math.min(MAX_PROGRESS, Math.max(MIN_PROGRESS, fraction));
    const target: number = Math.min(
      Math.floor(clampedFraction * doc.totalWords),
      doc.totalWords - ONE,
    );
    this.goToWord(target);
  }

  /**
   * Sets the playback rate, applying it immediately when playing.
   * @param rate The new rate multiplier.
   */
  public setRate(rate: number): void {
    this.rateState.set(rate);
    if (this.playingState()) {
      this.speakFrom(this.clampedIndex());
    }
  }

  /**
   * Sets the highlight mode (word or sentence).
   * @param mode The new highlight mode.
   */
  public setHighlightMode(mode: HighlightMode): void {
    this.highlightState.set(mode);
  }

  /**
   * Selects the voice with the given URI, applying it immediately when playing.
   * @param uri The voice URI.
   */
  public setVoiceUri(uri: string): void {
    this.selectedVoiceState.set(uri);
    if (this.playingState()) {
      this.speakFrom(this.clampedIndex());
    }
  }

  /**
   * Overrides the speech engine. Intended for tests, which supply a fake synthesiser and utterance
   * factory so the platform speech API is not touched.
   * @param synthesis The speech controller to use, or null.
   * @param factory The utterance factory to use.
   */
  public setSpeechEngine(synthesis: SpeechSynthesis | null, factory: UtteranceFactory): void {
    this.synthesis = synthesis;
    this.utteranceFactory = factory;
    this.loadVoices();
  }

  /**
   * Gets the estimated seconds to speak the given number of words at the current rate.
   * @param words The number of words spoken.
   * @returns Returns the estimated duration in seconds.
   */
  private secondsFor(words: number): number {
    const rate: number = this.rateState();
    return (words / (WORDS_PER_MINUTE * rate)) * SECONDS_PER_MINUTE;
  }

  /**
   * Moves the highlight to the given word, restarting speech when playing.
   * @param wordIndex The target word index.
   */
  private goToWord(wordIndex: number): void {
    const total: number = this.document().totalWords;
    if (total === ZERO) {
      return;
    }
    const clamped: number = Math.min(Math.max(ZERO, wordIndex), total - ONE);
    this.currentWordState.set(clamped);
    if (this.playingState()) {
      this.speakFrom(clamped);
    }
  }

  /**
   * Speaks the active paragraph starting at the given word.
   * @param wordIndex The word to begin speaking from.
   */
  private speakFrom(wordIndex: number): void {
    const synth: SpeechSynthesis | null = this.synthesis;
    const doc: ReadDocument = this.document();
    if (synth === null || wordIndex < ZERO || wordIndex >= doc.totalWords) {
      return;
    }

    const generation: number = (this.generation += ONE);
    synth.cancel();

    const word: ReadWord = doc.words[wordIndex];
    const paragraph: ReadParagraph = doc.paragraphs[word.paragraphIndex];
    this.activeParagraphIndex = word.paragraphIndex;
    this.baseCharOffset = word.charOffset;

    const utterance: SpeechSynthesisUtterance = this.utteranceFactory(
      paragraph.text.slice(word.charOffset),
    );
    utterance.rate = this.rateState();
    const voice: SpeechSynthesisVoice | null = this.resolveVoice();
    if (voice !== null) {
      utterance.voice = voice;
    }
    utterance.onboundary = (event: SpeechSynthesisEvent): void => {
      if (generation === this.generation) {
        this.handleBoundary(event);
      }
    };
    utterance.onend = (): void => {
      if (generation === this.generation) {
        this.handleEnd();
      }
    };

    this.currentWordState.set(wordIndex);
    synth.speak(utterance);
  }

  /**
   * Advances the highlighted word to match a speech boundary event.
   * @param event The boundary event from the active utterance.
   */
  private handleBoundary(event: SpeechSynthesisEvent): void {
    if (event.name !== '' && event.name !== 'word') {
      return;
    }
    const doc: ReadDocument = this.document();
    const paragraph: ReadParagraph | undefined = doc.paragraphs[this.activeParagraphIndex];
    if (paragraph === undefined) {
      return;
    }
    const charInParagraph: number = this.baseCharOffset + event.charIndex;
    const paragraphWords: readonly ReadWord[] = doc.words.slice(
      paragraph.startWord,
      paragraph.startWord + paragraph.wordCount,
    );
    let target: number = paragraph.startWord;
    for (const word of paragraphWords) {
      if (word.charOffset <= charInParagraph) {
        target = word.globalIndex;
      } else {
        break;
      }
    }
    this.zone.run((): void => this.currentWordState.set(target));
  }

  /**
   * Advances to the next paragraph when an utterance finishes, or stops at the end of the document.
   */
  private handleEnd(): void {
    const doc: ReadDocument = this.document();
    const nextParagraph: number = this.activeParagraphIndex + ONE;
    if (this.playingState() && nextParagraph < doc.paragraphs.length) {
      this.speakFrom(doc.paragraphs[nextParagraph].startWord);
    } else {
      this.zone.run((): void => this.playingState.set(false));
    }
  }

  /**
   * Resolves the selected {@link SpeechSynthesisVoice}, if any.
   * @returns Returns the matching voice, or null.
   */
  private resolveVoice(): SpeechSynthesisVoice | null {
    const uri: string | null = this.selectedVoiceState();
    if (this.synthesis === null || uri === null) {
      return null;
    }
    return (
      this.synthesis
        .getVoices()
        .find((voice: SpeechSynthesisVoice): boolean => voice.voiceURI === uri) ?? null
    );
  }

  /**
   * Loads the platform voices into the voices signal, selecting a default.
   */
  private loadVoices(): void {
    if (this.synthesis === null) {
      return;
    }
    const voices: SpeechSynthesisVoice[] = this.synthesis.getVoices();
    this.voicesState.set(
      voices.map(
        (voice: SpeechSynthesisVoice): VoiceOption => ({
          uri: voice.voiceURI,
          name: voice.name,
          lang: voice.lang,
        }),
      ),
    );
    if (this.selectedVoiceState() === null && voices.length > ZERO) {
      this.selectedVoiceState.set(voices[ZERO].voiceURI);
    }
  }
}
