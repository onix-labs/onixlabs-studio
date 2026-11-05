/**
 * The width of one level of indentation.
 */
const indentWidth: number = 2;

/**
 * Finds where a string token ends.
 * @param json The JSON text.
 * @param start The index of the opening quote.
 * @returns Returns the index just past the closing quote.
 */
function endOfString(json: string, start: number): number {
  let index: number = start + 1;
  while (index < json.length && json[index] !== '"') {
    index += json[index] === '\\' ? 2 : 1;
  }
  return index + 1;
}

/**
 * Finds the next character that is not JSON whitespace.
 * @param json The JSON text.
 * @param start The index to look from.
 * @returns Returns the index of that character.
 */
function skipWhitespace(json: string, start: number): number {
  let index: number = start;
  while (index < json.length && ' \t\r\n'.includes(json.charAt(index))) {
    index += 1;
  }
  return index;
}

/**
 * Lays out valid JSON text with one member per line, keeping every token as it came. Going through
 * `JSON.parse` would round a large integer to the nearest double, reorder integer-like keys and drop
 * repeated ones, so what is shown would not be what the server sent.
 * @param json Text that is already known to be valid JSON.
 * @returns Returns the text with its whitespace replaced.
 */
export function indentJson(json: string): string {
  const pieces: string[] = [];
  let depth: number = 0;
  let index: number = 0;
  const newline: () => string = (): string => `\n${' '.repeat(depth * indentWidth)}`;

  while (index < json.length) {
    const character: string = json.charAt(index);
    if (character === '"') {
      const end: number = endOfString(json, index);
      pieces.push(json.slice(index, end));
      index = end;
      continue;
    }
    index += 1;
    if (character === '{' || character === '[') {
      const next: number = skipWhitespace(json, index);
      if (json[next] === '}' || json[next] === ']') {
        pieces.push(character, json.charAt(next));
        index = next + 1;
      } else {
        depth += 1;
        pieces.push(character, newline());
      }
    } else if (character === '}' || character === ']') {
      depth -= 1;
      pieces.push(newline(), character);
    } else if (character === ',') {
      pieces.push(character, newline());
    } else if (character === ':') {
      pieces.push(': ');
    } else if (skipWhitespace(character, 0) === 0) {
      pieces.push(character);
    }
  }
  return pieces.join('');
}
