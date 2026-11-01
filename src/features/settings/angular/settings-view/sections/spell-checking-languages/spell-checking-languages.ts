import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import {
  MultiSelect,
  MultiSelectItem,
} from '@shared/angular/components/forms/multi-select/multi-select';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Spelling } from '@shared/angular/services/spelling/spelling';

/**
 * Represents the Spell Checking Languages row on Application › General: the languages text boxes and
 * Markdown review check together. On macOS Chromium checks a single language, the system's, and Electron
 * cannot change it, so the row says so instead of offering a list (ruled on #1230).
 */
@Component({
  selector: 'app-spell-checking-languages',
  imports: [MultiSelect, SettingRow],
  templateUrl: './spell-checking-languages.html',
  styleUrls: ['../section.scss', './spell-checking-languages.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpellCheckingLanguages implements OnInit {
  /**
   * Holds the app's spell checking.
   */
  protected readonly spelling: Spelling = inject(Spelling);

  /**
   * Holds the language codes the spell checker supports, once listed.
   */
  private readonly available: WritableSignal<readonly string[]> = signal<readonly string[]>([]);

  /**
   * Gets the languages offered, each named in the interface's language and sorted by that name. A
   * chosen language the checker no longer lists is kept, so it can still be unticked.
   */
  protected readonly options: Signal<readonly MultiSelectItem[]> = computed(
    (): readonly MultiSelectItem[] => {
      const names: Intl.DisplayNames = new Intl.DisplayNames([navigator.language, 'en'], {
        type: 'language',
      });
      const codes: ReadonlySet<string> = new Set<string>([
        ...this.available(),
        ...this.spelling.languages(),
      ]);
      return [...codes]
        .map((code: string): MultiSelectItem => ({ value: code, label: names.of(code) ?? code }))
        .sort((left: MultiSelectItem, right: MultiSelectItem): number =>
          left.label.localeCompare(right.label),
        );
    },
  );

  /**
   * Lists the supported languages when the row is shown.
   */
  public ngOnInit(): void {
    void this.spelling
      .availableLanguages()
      .then((codes: readonly string[]): void => this.available.set(codes));
  }

  /**
   * Applies the chosen languages.
   * @param codes The ticked language codes.
   */
  protected choose(codes: readonly string[]): void {
    this.spelling.setLanguages(codes);
  }
}
