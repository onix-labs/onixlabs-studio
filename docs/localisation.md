# Localisation

Studio's interface can be shown in English, French, Spanish and German. This page says how the
translation machinery works, how to mark text for translation, and what is still to do. It started as
a spike, so most of the interface is not marked yet and reads in English in every language.

## How it works

Studio uses Angular's own translation support (`@angular/localize`), with the translations loaded
when Studio starts rather than baked into a separate build per language.

- **The language setting.** Settings › Application › Language. Match the System (the default) takes
  the first of the system's preferred languages that Studio speaks, and English when it speaks none.
  The setting is mirrored to the main process with the other startup settings, so the next window
  knows it before any of Studio's code has loaded.
- **Loading.** `src/shared/app/main.ts` loads the language (`locale/load-language.ts`) and only then
  imports the rest of Studio (`start-studio.ts`). The order matters: text in plain TypeScript, such as
  the settings registry and the menus, is translated as its module is first read.
- **Changing language restarts Studio.** For the same reason, a new language can't be swapped in
  while Studio runs. The setting raises the usual "restart required" banner.
- **Missing translations read in English.** A language file only holds what has been translated, and
  the loader fills the gaps from the English source. So marking text is safe before anyone has
  translated it.
- **Dates and numbers** follow the language, in the system's region where it prefers a variant of
  that language (French in Canada formats as Canadians do). `interfaceLocale()` gives the locale
  to pass to `Intl`. `formatTimeAgo()` phrases "5 min ago" in any language.

## Marking text

In templates, add `i18n` to an element and `i18n-<attribute>` to an attribute, with a note for the
translator saying what the text is:

```html
<p class="hint" i18n="Shown when the recent items list is empty">No recent items</p>
<app-button label="Clear" i18n-label="Clears the recent items list" />
```

In TypeScript, use `$localize` with the note between colons:

```ts
label: $localize`:Welcome screen tab:Get Started`,
```

Rules that keep translations possible:

- **Never build a sentence out of pieces.** `'Started ' + time` or `count === 1 ? '' : 's'` can't be
  translated: other languages reorder words and have different plural rules. Mark the whole
  sentence, with the changing parts as placeholders: `` $localize`Started ${time}:time:` ``.
- **Plurals** use Angular's plural syntax in templates:
  `{count(), plural, =1 {1 update} other {{{ count() }} updates}}`.
- **No colons in a translator's note.** The note ends at the first colon, and the rest becomes part of
  the message. Write `14.32`, not `14:32`, in an example.
- **A binding can't be marked.** For `[tooltip]="busy ? 'Working' : ''"`, move the text into the
  component as a `$localize` field and bind to that.
- **Short words need context.** "View" as a menu and "View" as a button may be different words in
  French. Give each its own note, or a meaning (`:app-menu|An entry in the application menu:View`),
  which makes it a separate message.
- Leave product names, file formats and code in English: ONIXLabs Studio, Markdown, Docker, Git.

## Updating the translation files

```bash
node scripts/i18n.mjs
```

The script reads every marked message out of the code into `src/shared/app/locale/messages.json`
(generated, never edited), drops translations of messages the code no longer has, regenerates the
test language, and reports how much of each language is translated. It runs a build, so on a Mac it
has to run outside the agent sandbox.

Translators edit `messages.fr.json`, `messages.es.json` and `messages.de.json`, adding an entry for
each message id in `messages.json`. `translations.spec.ts` fails if a translation loses a
placeholder or refers to a message that no longer exists.

## The test language

Development builds offer **Pseudo (testing)** in the Language setting. Every marked message shows
accented, bracketed and a third longer, as German often is: `⟦Ñéŵ Ţéŕɱîñáļ····⟧`. Anything that
still reads as plain English hasn't been marked, and a bracket cut off by an ellipsis shows a place
where a translation won't fit.

## What the spike covers

Marked and translated: the application menu (and so the macOS menu bar), the Welcome screen's frame
and its Get Started and Tools tabs, the first five settings in Settings › Application, and the time
helpers (commit ages, durations, task timings). That's 122 messages. The French, Spanish and German
were drafted by an AI and need review by native speakers.

## What is still to do

- **Mark the rest of the interface.** About 300 templates and a few thousand messages in TypeScript,
  feature by feature. `@angular-eslint/template/i18n` can then be turned on for each finished
  feature, so new text can't arrive unmarked.
- **Rewrite the sentences built from pieces.** About 73 hand-made plurals, plus text assembled in
  code. One example the spike shows: Settings adds "Automatic resolves to Full on this system." to a
  translated description, in English.
- **Fit longer text.** French and German labels are clipped on the Welcome screen's tabs and action
  buttons. The test language shows the same clipping everywhere else.
- **The main process.** Native dialogs, notifications and error messages written in the main process
  aren't covered. It needs the same loader, fed the language from the startup settings. The macOS
  application menu's built-in entries (Hide, Services, Quit) follow the system's language, not
  Studio's.
- **The code editor.** Monaco has its own text (the find box, its context menu), with its own way of
  loading translations before it starts.
- **Plugins.** Plugins run separately and are released separately. They need to be told the language,
  and to ship their own translations, with text from third-party plugins left in English.
- **Agents.** The instructions and tool descriptions Studio gives agents should stay in English, with
  the user's language passed along so agents reply in it.
- **Right-to-left languages.** Arabic and Hebrew need mirrored layouts. Most of the styles already use
  direction-neutral properties; about 51 places still say left or right.
