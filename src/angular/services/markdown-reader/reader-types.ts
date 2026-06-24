/**
 * Which span of text the in-document highlight covers during playback.
 */
export type HighlightMode = 'word' | 'sentence';

/**
 * A selectable text-to-speech voice.
 */
export interface VoiceOption {
  /**
   * Gets the stable voice identifier (`SpeechSynthesisVoice.voiceURI`).
   */
  readonly uri: string;

  /**
   * Gets the human-readable voice name.
   */
  readonly name: string;

  /**
   * Gets the BCP-47 language tag.
   */
  readonly lang: string;
}

/**
 * The seam the active markdown editor registers with the reader service, so the service can highlight
 * the spoken word or sentence inside the rendered document and scroll it into view.
 */
export interface ReadSession {
  /**
   * Highlights the word at the given index (or its sentence) in the document.
   * @param wordIndex The word index.
   * @param mode The highlight mode.
   */
  highlight(wordIndex: number, mode: HighlightMode): void;

  /**
   * Clears any read-along highlight in the document.
   */
  clearHighlight(): void;

  /**
   * Scrolls the word at the given index into view when it is off-screen.
   * @param wordIndex The word index.
   */
  revealWord(wordIndex: number): void;
}
