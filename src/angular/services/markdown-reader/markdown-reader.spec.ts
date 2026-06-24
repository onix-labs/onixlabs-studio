import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { Reader } from './markdown-reader';
import { tokenizeDocument } from './read-tokenize';
import { ReadSession } from './reader-types';

/**
 * A minimal fake speech synthesiser recording transport calls, standing in for the platform API.
 */
class FakeSynthesis {
  public speaking: boolean = false;
  public paused: boolean = false;
  public onvoiceschanged: (() => void) | null = null;
  public readonly spoken: SpeechSynthesisUtterance[] = [];

  public speak(utterance: SpeechSynthesisUtterance): void {
    this.speaking = true;
    this.spoken.push(utterance);
  }

  public cancel(): void {
    this.speaking = false;
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    this.paused = false;
  }

  public getVoices(): SpeechSynthesisVoice[] {
    return [
      { voiceURI: 'v1', name: 'Voice One (Enhanced)', lang: 'en-US' } as SpeechSynthesisVoice,
      { voiceURI: 'v2', name: 'Voice Two', lang: 'en-US' } as SpeechSynthesisVoice,
    ];
  }
}

/**
 * Builds a fake utterance whose mutable fields the service can set.
 * @param text The text to speak.
 * @returns Returns the fake utterance.
 */
function fakeUtterance(text: string): SpeechSynthesisUtterance {
  return { text, rate: 1, voice: null, onboundary: null, onend: null } as unknown as SpeechSynthesisUtterance;
}

/**
 * A fake read session recording highlight and reveal calls.
 */
function fakeSession(): ReadSession {
  return {
    highlight: vi.fn(),
    clearHighlight: vi.fn(),
    revealWord: vi.fn(),
  };
}

describe('Reader', () => {
  let reader: Reader;
  let synthesis: FakeSynthesis;

  beforeEach(() => {
    reader = TestBed.inject(Reader);
    synthesis = new FakeSynthesis();
    reader.setSpeechEngine(synthesis as unknown as SpeechSynthesis, fakeUtterance);
  });

  it('canRead_whenNoDocument_isFalse', () => {
    expect(reader.canRead()).toBe(false);
  });

  it('canRead_whenDocumentPublished_isTrue', () => {
    reader.setDocument(tokenizeDocument('Hello world', true));
    expect(reader.canRead()).toBe(true);
  });

  it('voices_whenEngineSet_loadsOnlyEnhancedVoicesWithADefaultSelection', () => {
    expect(reader.voices().map((voice): string => voice.uri)).toEqual(['v1']);
    expect(reader.selectedVoice()?.uri).toBe('v1');
  });

  it('play_whenDocumentPublished_marksPlayingAndSpeaks', () => {
    reader.setDocument(tokenizeDocument('Hello world', true));
    reader.play();
    expect(reader.isPlaying()).toBe(true);
    expect(synthesis.spoken.length).toBe(1);
  });

  it('pause_whenPlaying_marksNotPlaying', () => {
    reader.setDocument(tokenizeDocument('Hello world', true));
    reader.play();
    reader.pause();
    expect(reader.isPlaying()).toBe(false);
  });

  it('stop_whenCalled_rewindsToTheStartAndStops', () => {
    reader.setDocument(tokenizeDocument('Hello world foo bar', true));
    reader.play();
    reader.seekToFraction(1);
    reader.stop();
    expect(reader.isPlaying()).toBe(false);
    expect(reader.currentWordIndex()).toBe(0);
  });

  it('skipForward_whenMultipleParagraphs_jumpsToTheNextParagraph', () => {
    reader.setDocument(tokenizeDocument('one two\n\nthree four five', true));
    reader.skipForward();
    expect(reader.currentWordIndex()).toBe(2);
  });

  it('seekToFraction_whenSeeking_movesToTheProportionalWord', () => {
    reader.setDocument(tokenizeDocument('one two three four five', true));
    reader.seekToFraction(1);
    expect(reader.currentWordIndex()).toBe(4);
  });

  it('setRate_whenSet_updatesTheRate', () => {
    reader.setRate(1.5);
    expect(reader.rate()).toBe(1.5);
  });

  it('setHighlightMode_whenSet_updatesTheMode', () => {
    reader.setHighlightMode('sentence');
    expect(reader.highlightMode()).toBe('sentence');
  });

  it('unregisterSession_whenRemoved_stopsAndClearsTheDocument', () => {
    const session: ReadSession = fakeSession();
    reader.registerSession(session);
    reader.setDocument(tokenizeDocument('Hello world', true));
    expect(reader.canRead()).toBe(true);

    reader.unregisterSession(session);

    expect(reader.canRead()).toBe(false);
    expect(reader.isPlaying()).toBe(false);
  });
});
