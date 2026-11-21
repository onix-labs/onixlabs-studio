import { registerLocaleData } from '@angular/common';
import { loadTranslations } from '@angular/localize';
import type { InterfaceLanguage } from '@shared/api/startup-settings';
import { formattingLocale } from '@shared/angular/services/locale/formatting-locale';
import { resolveLanguage } from '@shared/angular/services/locale/resolve-language';
import type { SpokenLanguage } from '@shared/angular/services/locale/spoken-language';
import { embedRightToLeft } from './embed-right-to-left';
import { isTranslationFile } from './is-translation-file';
import type { JsonModule } from './json-module';

/**
 * Reads a bundled translation file's messages, or none when the file is malformed.
 * @param module The file's module, as a dynamic import yields it.
 * @returns Returns the messages, by id.
 */
function messagesOf(module: JsonModule): Readonly<Record<string, string>> {
  return isTranslationFile(module.default) ? module.default.translations : {};
}

/**
 * Loads a language's translations. Each is its own chunk, so a launch only ever reads the one it shows.
 * @param language The language, other than English, which is the source and needs none.
 * @returns Returns the file's module.
 */
async function translationsFor(language: Exclude<SpokenLanguage, 'en'>): Promise<JsonModule> {
  switch (language) {
    case 'fr':
      return import('./messages.fr.json');
    case 'es':
      return import('./messages.es.json');
    case 'de':
      return import('./messages.de.json');
    case 'zh-Hans':
      return import('./messages.zh-Hans.json');
    case 'ar':
      return import('./messages.ar.json');
    case 'pseudo':
      return import('./messages.pseudo.json');
  }
}

/**
 * Loads the formatting data Angular's own pipes need for a language, such as month names for the date
 * pipe. Angular carries American English itself; every other locale has to be registered.
 * @param language The language.
 * @returns Returns the locale data.
 */
async function localeDataFor(language: SpokenLanguage): Promise<unknown> {
  switch (language) {
    case 'fr':
      return (await import('@angular/common/locales/fr')).default;
    case 'es':
      return (await import('@angular/common/locales/es')).default;
    case 'de':
      return (await import('@angular/common/locales/de')).default;
    case 'zh-Hans':
      // Registered as `zh`, whose data is Simplified Chinese's, so the regional locales the
      // formatting locale may be (`zh-CN`, `zh-SG`, `zh-Hans`) all find it as their parent.
      return (await import('@angular/common/locales/zh')).default;
    case 'ar':
      return (await import('@angular/common/locales/ar')).default;
    case 'en':
    case 'pseudo':
      return (await import('@angular/common/locales/en-GB')).default;
  }
}

/**
 * Puts the interface's language in force for this launch, before any of the interface's code has
 * loaded.
 *
 * It has to come first. Angular translates a component's text as the component is first created,
 * but plain code translates as its module is first read: the settings registry's titles, the menu's
 * labels. So the translations are loaded here and the rest of Studio is imported afterwards (see
 * `main.ts`). Changing the language therefore restarts Studio, as changing it in VS Code does.
 *
 * A translation file only holds what has been translated. The source messages fill the rest, so
 * untranslated text reads in English, rather than the localize runtime warning about it each time it
 * is shown.
 *
 * The document's `lang` is set here too, before the first paint: it picks the fonts for the script
 * (Simplified rather than Japanese forms of shared Han characters), and child windows copy it from
 * their opener (see `ChildWindowStyling`). The layout stays left to right in every language, as most
 * IDEs' do; right-to-left text takes its direction paragraph by paragraph instead (see
 * `styles/_direction.scss`).
 * @param setting The Language setting, as the main process mirrored it.
 * @param preferred The operating system's preferred languages, most preferred first.
 * @returns Returns the language the interface is shown in.
 */
export async function loadLanguage(
  setting: InterfaceLanguage,
  preferred: readonly string[],
): Promise<SpokenLanguage> {
  const language: SpokenLanguage = resolveLanguage(setting, preferred);
  const locale: string = formattingLocale(language, preferred);
  registerLocaleData(await localeDataFor(language));
  $localize.locale = locale;
  document.documentElement.lang = language === 'pseudo' ? 'en' : locale;
  if (language === 'en') {
    return language;
  }
  const [source, target]: [JsonModule, JsonModule] = await Promise.all([
    import('./messages.json'),
    translationsFor(language),
  ]);
  // Arabic's messages are embedded right to left, so a label keeps its words in order in Studio's
  // left-to-right layout (see `embedRightToLeft`). Untranslated English is left as it is.
  const translated: Readonly<Record<string, string>> =
    language === 'ar' ? embedRightToLeft(messagesOf(target)) : messagesOf(target);
  loadTranslations({ ...messagesOf(source), ...translated });
  return language;
}
