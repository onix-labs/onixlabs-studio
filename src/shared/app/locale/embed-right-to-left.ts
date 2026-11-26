/**
 * Holds the start of a right-to-left embedding (U+202B) followed by a right-to-left mark (U+200F).
 */
const EMBED: string = String.fromCodePoint(0x202b, 0x200f);

/**
 * Holds the end of the embedding (U+202C).
 */
const END: string = String.fromCodePoint(0x202c);

/**
 * Lays each message of a right-to-left language out right to left, wherever it is shown.
 *
 * Studio's layout stays left to right in every language, so a label is shown in a left-to-right line.
 * There an Arabic label with a Latin word in it, `ملف Markdown جديد` ("New Markdown File"), would be
 * laid out word by word from the left and read in the wrong order. Embedding the whole message right
 * to left keeps its words in order without moving it: a label stays where it was, aligned as before.
 *
 * An embedding, not an isolate: the browser skips an isolate's content when it works out a paragraph's
 * direction from its first letter, which is how the interface's prose lines up on the right (see
 * `styles/_direction.scss`). The mark makes that first letter right to left even when the message
 * starts with a Latin word, such as `Studio`.
 *
 * A plural or select is left as it is: it has to be the whole of its message, and its cases are short.
 * @param messages The language's messages, by id.
 * @returns Returns the messages, each embedded right to left.
 */
export function embedRightToLeft(
  messages: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(messages).map(([id, text]: [string, string]): [string, string] => [
      id,
      /^\{\w+, (plural|select),/.test(text) ? text : `${EMBED}${text}${END}`,
    ]),
  );
}
