import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { Reader } from '../../../../../services/markdown-reader/markdown-reader';
import { HighlightMode, VoiceOption } from '../../../../../services/markdown-reader/reader-types';
import { MarkdownToolPanel } from '../markdown-tool-panel/markdown-tool-panel';

/**
 * Upper bound of the scrubber range input, giving sub-percent seek granularity.
 */
const SCRUB_MAX: number = 1000;

/**
 * Multiplier converting a 0–1 fraction to a percentage.
 */
const PERCENT: number = 100;

/**
 * Slow (0.75×) playback option.
 */
const SPEED_SLOW: number = 0.75;

/**
 * Normal (1×) playback option.
 */
const SPEED_NORMAL: number = 1;

/**
 * Faster (1.5×) playback option.
 */
const SPEED_FAST: number = 1.5;

/**
 * Fastest (2×) playback option.
 */
const SPEED_FASTEST: number = 2;

/**
 * Selectable playback speeds.
 */
const SPEEDS: readonly number[] = [SPEED_SLOW, SPEED_NORMAL, SPEED_FAST, SPEED_FASTEST];

/**
 * The Reader tool panel: reads the active document aloud through the platform Speech Synthesis API —
 * the spoken word or sentence is highlighted in the document itself — with transport, scrubber,
 * speed, highlight-mode, and voice controls.
 */
@Component({
  selector: 'app-markdown-reader-panel',
  imports: [MarkdownToolPanel, AppIcon, Dropdown],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './markdown-reader-panel.html',
  styleUrl: './markdown-reader-panel.scss',
})
export class MarkdownReaderPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the reader playback service.
   */
  private readonly reader: Reader = inject(Reader);

  /**
   * Gets whether there is a document available to read.
   */
  protected readonly canRead: Signal<boolean> = this.reader.canRead;

  /**
   * Gets whether playback is active.
   */
  protected readonly isPlaying: Signal<boolean> = this.reader.isPlaying;

  /**
   * Gets playback progress as a fraction (0–1).
   */
  protected readonly progress: Signal<number> = this.reader.progress;

  /**
   * Gets the estimated elapsed time label.
   */
  protected readonly elapsedLabel: Signal<string> = this.reader.elapsedLabel;

  /**
   * Gets the estimated total duration label.
   */
  protected readonly totalLabel: Signal<string> = this.reader.totalLabel;

  /**
   * Gets the active playback rate.
   */
  protected readonly rate: Signal<number> = this.reader.rate;

  /**
   * Gets the active highlight mode.
   */
  protected readonly highlightMode: Signal<HighlightMode> = this.reader.highlightMode;

  /**
   * Gets the available voices.
   */
  protected readonly voices: Signal<readonly VoiceOption[]> = this.reader.voices;

  /**
   * Gets the selected voice.
   */
  protected readonly selectedVoice: Signal<VoiceOption | null> = this.reader.selectedVoice;

  /**
   * Gets the available voices as dropdown options.
   */
  protected readonly voiceOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.voices().map(
        (voice: VoiceOption): DropdownOption => ({
          value: voice.uri,
          label: `${voice.name} · ${voice.lang}`,
        }),
      ),
  );

  /**
   * Gets the selected voice's URI, or an empty string when none is selected.
   */
  protected readonly selectedVoiceUri: Signal<string> = computed(
    (): string => this.selectedVoice()?.uri ?? '',
  );

  /**
   * Gets the selectable playback speeds.
   */
  protected readonly speeds: readonly number[] = SPEEDS;

  /**
   * Gets the upper bound of the scrubber range input.
   */
  protected readonly scrubMax: number = SCRUB_MAX;

  /**
   * Toggles play and pause.
   */
  protected onToggle(): void {
    this.reader.toggle();
  }

  /**
   * Skips to the previous paragraph.
   */
  protected onSkipBack(): void {
    this.reader.skipBackward();
  }

  /**
   * Skips to the next paragraph.
   */
  protected onSkipForward(): void {
    this.reader.skipForward();
  }

  /**
   * Seeks to the scrubber's position.
   * @param event The range input event.
   */
  protected onSeek(event: Event): void {
    const value: number = Number((event.target as HTMLInputElement).value);
    this.reader.seekToFraction(value / this.scrubMax);
  }

  /**
   * Sets the playback speed.
   * @param speed The speed multiplier.
   */
  protected onSpeed(speed: number): void {
    this.reader.setRate(speed);
  }

  /**
   * Sets the highlight mode.
   * @param mode The highlight mode.
   */
  protected onHighlight(mode: HighlightMode): void {
    this.reader.setHighlightMode(mode);
  }

  /**
   * Selects a voice.
   * @param uri The chosen voice URI.
   */
  protected onVoice(uri: string): void {
    this.reader.setVoiceUri(uri);
  }

  /**
   * Formats a speed multiplier as a label (for example `1.5×`).
   * @param speed The speed multiplier.
   * @returns Returns the label.
   */
  protected speedLabel(speed: number): string {
    return `${speed}×`;
  }

  /**
   * Gets the scrubber fill width as a CSS percentage string.
   * @returns Returns the fill percentage (for example `42%`).
   */
  protected fillPercent(): string {
    return `${this.progress() * PERCENT}%`;
  }
}
