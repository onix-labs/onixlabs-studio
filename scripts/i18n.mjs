#!/usr/bin/env node
// Keeps the interface's translation files in step with its text.
//
// Studio's text is marked in the code itself, with `i18n` attributes in templates and `$localize` in
// TypeScript. This script reads every marked message out of the code into the source file, then brings
// each language's file in line with it:
//
// - `messages.json` is the English source, written by `ng extract-i18n`. It is generated; never edit it.
// - `messages.<language>.json` holds that language's translations, and only those: a message with no
//   translation yet is simply absent, and reads in English (the startup loader fills it from the
//   source). Translations of messages the code no longer has are dropped, so a reworded message is
//   reported as untranslated rather than shown in its old wording.
// - `messages.pseudo.json` is the test language, generated from the source: every message accented,
//   bracketed and stretched by a third, the way German runs long. Text that still reads plainly in it
//   was never marked, and a clipped bracket is a layout that will not fit a translation.
//
//   node scripts/i18n.mjs            # extract, then update every language and report what is missing
//   node scripts/i18n.mjs --check    # fail when the source file is out of date with the code (for CI)

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';

const FOLDER = 'src/shared/app/locale';
const SOURCE = `${FOLDER}/messages.json`;
const LANGUAGES = ['fr', 'es', 'de', 'zh-Hans', 'ar'];

/**
 * Reads a translation file.
 * @param {string} path The file.
 * @returns {{ locale: string, translations: Record<string, string> }} The file.
 */
function read(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Writes a translation file with its messages in id order, so a change shows as a small diff.
 * @param {string} path The file.
 * @param {string} locale The locale its messages are in.
 * @param {Record<string, string>} translations The messages, by id.
 */
function write(path, locale, translations) {
  const sorted = Object.fromEntries(
    Object.entries(translations).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  writeFileSync(path, `${JSON.stringify({ locale, translations: sorted }, null, 2)}\n`);
}

const ACCENTS = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'î',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ö',
  p: 'þ',
  q: 'ǫ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'û',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Î',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ö',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Û',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

/**
 * Accents a run of plain text and pads it by a third.
 * @param {string} text The text.
 * @returns {string} The pseudo text.
 */
function accent(text) {
  const letters = [...text].filter((character) => /\p{L}/u.test(character)).length;
  const padding = letters === 0 ? '' : '·'.repeat(Math.ceil(letters / 3));
  return [...text].map((character) => ACCENTS[character] ?? character).join('') + padding;
}

/**
 * Pseudo-translates a message, leaving its placeholders (`{$INTERPOLATION}`) and the structure of its
 * plurals and selects (`{VAR_PLURAL, plural, =1 {…} other {…}}`) as they are: only their text changes.
 * @param {string} message The source message.
 * @returns {string} The pseudo message.
 */
function pseudo(message) {
  let index = 0;

  // Reads text up to the end of the message, or to the `}` that closes the case it is in.
  const text = () => {
    let out = '';
    let run = '';
    while (index < message.length && message[index] !== '}') {
      if (message[index] !== '{') {
        run += message[index++];
        continue;
      }
      out += accent(run);
      run = '';
      out += isPlaceholder() ? placeholder() : expression();
    }
    return out + accent(run);
  };

  // Tells a placeholder from a plural or select. Outside one, a placeholder reads `{$NAME}`; inside a
  // case it reads `{NAME}`. Either way it has no comma, and an expression always does.
  const isPlaceholder = () => {
    const close = message.indexOf('}', index);
    return !message.slice(index, close).includes(',');
  };

  // Copies a placeholder, `{$NAME}` or `{NAME}`, untouched.
  const placeholder = () => {
    const end = message.indexOf('}', index);
    const out = message.slice(index, end + 1);
    index = end + 1;
    return out;
  };

  // Copies a plural or select's selector and case keys, translating each case's text.
  const expression = () => {
    const head = message.indexOf(',', message.indexOf(',', index) + 1);
    let out = message.slice(index, head + 1);
    index = head + 1;
    while (index < message.length && message[index] !== '}') {
      const open = message.indexOf('{', index);
      out += message.slice(index, open + 1);
      index = open + 1;
      out += `${text()}}`;
      index += 1;
      const close = /^\s*/.exec(message.slice(index))[0];
      out += close;
      index += close.length;
    }
    index += 1;
    return `${out}}`;
  };

  const translated = text();
  // A plural or select has to be the whole of its message, so only plain messages are bracketed.
  return /^\{\w+, (plural|select),/.test(message) ? translated : `⟦${translated}⟧`;
}

const check = argv.includes('--check');
const before = check ? readFileSync(SOURCE, 'utf8') : '';
const extract = spawnSync(
  'npx',
  ['ng', 'extract-i18n', '--format=json', `--output-path=${FOLDER}`, '--out-file=messages.json'],
  { stdio: 'inherit' },
);
if (extract.status !== 0) {
  exit(extract.status ?? 1);
}
if (check) {
  if (readFileSync(SOURCE, 'utf8') !== before) {
    stdout.write(`${SOURCE} is out of date: run node scripts/i18n.mjs and commit the result.\n`);
    exit(1);
  }
  exit(0);
}

const source = read(SOURCE);
// The extractor writes its own layout; rewrite it sorted, as the other files are.
write(SOURCE, source.locale, source.translations);
const ids = Object.keys(source.translations);

write(
  `${FOLDER}/messages.pseudo.json`,
  'en-GB',
  Object.fromEntries(ids.map((id) => [id, pseudo(source.translations[id])])),
);

for (const language of LANGUAGES) {
  const path = `${FOLDER}/messages.${language}.json`;
  const file = read(path);
  const kept = Object.fromEntries(
    Object.entries(file.translations).filter(([id]) => id in source.translations),
  );
  const dropped = Object.keys(file.translations).length - Object.keys(kept).length;
  write(path, file.locale, kept);
  const missing = ids.filter((id) => !(id in kept)).length;
  stdout.write(
    `${language}: ${ids.length - missing} of ${ids.length} translated` +
      (dropped > 0 ? `, ${dropped} out of date dropped` : '') +
      '\n',
  );
}
