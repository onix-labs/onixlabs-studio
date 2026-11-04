import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Substring (case-insensitive) that marks one of the platform's higher-quality voices.
 */
const ENHANCED_VOICE: string = 'enhanced';

/**
 * Represents the Read Aloud Voice row on Markdown › Review and Reading. Voices are enumerated here and
 * in the Reader panel only: on macOS the first enumeration stalls the app for a moment, so opening a
 * document never pays for it.
 */
@Component({
  selector: 'app-read-aloud-voice',
  imports: [Dropdown, SettingRow],
  template: `
    <app-setting-row
      label="Read Aloud Voice"
      description="The voice documents are read in. The Reader panel can change it for a session."
    >
      <app-dropdown
        ariaLabel="Read aloud voice"
        [options]="options()"
        [value]="settings.value('markdownEditor.readAloudVoice')()"
        (valueChange)="choose($event)"
      />
    </app-setting-row>
  `,
  styleUrl: '../section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReadAloudVoice implements OnInit, OnDestroy {
  /**
   * Holds the settings the choice is stored in.
   */
  protected readonly settings: Settings = inject(Settings);

  /**
   * Holds the platform's voices, once listed.
   */
  private readonly voices: WritableSignal<readonly SpeechSynthesisVoice[]> = signal<
    readonly SpeechSynthesisVoice[]
  >([]);

  /**
   * Holds the listener that lists the voices again when the platform's list arrives.
   */
  private readonly list: () => void = (): void => this.voices.set(speechSynthesis.getVoices());

  /**
   * Gets the voices offered: the enhanced ones while that is asked for and there are any, and always
   * the system's default.
   */
  protected readonly options: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => {
      const voices: readonly SpeechSynthesisVoice[] = this.voices();
      const enhanced: readonly SpeechSynthesisVoice[] = voices.filter(
        (voice: SpeechSynthesisVoice): boolean => voice.name.toLowerCase().includes(ENHANCED_VOICE),
      );
      const shown: readonly SpeechSynthesisVoice[] =
        this.settings.get('markdownEditor.enhancedVoicesOnly') && enhanced.length > 0
          ? enhanced
          : voices;
      return [
        { value: '', label: 'System Default' },
        ...shown.map((voice: SpeechSynthesisVoice): DropdownOption => ({
          value: voice.voiceURI,
          label: `${voice.name} · ${voice.lang}`,
        })),
      ];
    },
  );

  /**
   * Lists the voices when the row is shown, off the path of the page's own first paint.
   */
  public ngOnInit(): void {
    if (typeof speechSynthesis === 'undefined') {
      return;
    }
    speechSynthesis.addEventListener('voiceschanged', this.list);
    setTimeout(this.list);
  }

  /**
   * Stops listening for the platform's voices.
   */
  public ngOnDestroy(): void {
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.removeEventListener('voiceschanged', this.list);
    }
  }

  /**
   * Stores the chosen voice.
   * @param voice The voice's identifier, or the empty string for the system's default.
   */
  protected choose(voice: string): void {
    this.settings.set('markdownEditor.readAloudVoice', voice);
  }
}
