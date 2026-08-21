import { Type } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { ApiExplorerStatus } from '@features/api-explorer/angular/api-explorer-status/api-explorer-status';
import { BinaryStatusStrip } from '@features/binary/angular/binary-status/binary-status-strip';
import { CodeStatusStrip } from '@features/code/angular/code-status/code-status-strip';
import { MarkdownStatusStrip } from '@features/markdown/angular/markdown-status/markdown-status-strip';
import { TerminalStatusStrip } from '@features/terminal/angular/terminal-status/terminal-status-strip';
import { DirectoryStatusStrip } from '@features/workspace/angular/directory-status/directory-status-strip';
import { StatusStripSegments } from './status-strip-segments/status-strip-segments';

/**
 * Reads a component's compiled styles. Angular exposes these only on the internal definition, so the
 * cast is deliberate — and the check below fails loudly if a future Angular stops populating it,
 * rather than passing vacuously.
 * @param component The component to read.
 * @returns Returns the compiled style strings.
 */
function stylesOf(component: Type<unknown>): readonly string[] {
  return (component as unknown as { ɵcmp?: { styles?: readonly string[] } }).ɵcmp?.styles ?? [];
}

/**
 * Guards the contract every status-strip component is held to: its host must add no box of its own.
 *
 * The strip lays the segment groups and their flexible spacer out in one flex row, and that spacer is
 * what pushes the trailing segments — and the ambient region behind them, including the notification
 * bell — to the end of the bar. A component host that makes a shrink-to-fit box traps the spacer in
 * its own formatting context and everything bunches up on the left. Nothing throws, so this is only
 * ever noticed by eye, which is exactly why it is checked here.
 *
 * The container's own encapsulated styles cannot fix this from the outside: a host element created by
 * `ngComponentOutlet` does not carry the container's content attribute, so each component declares
 * `:host { display: contents; }` itself.
 */
describe('status strip contract', () => {
  const COMPONENTS: readonly (readonly [string, Type<unknown>])[] = [
    ['segments', StatusStripSegments],
    ['code', CodeStatusStrip],
    ['markdown', MarkdownStatusStrip],
    ['terminal', TerminalStatusStrip],
    ['binary', BinaryStatusStrip],
    ['api-explorer', ApiExplorerStatus],
    ['workspace', DirectoryStatusStrip],
  ];

  for (const [name, component] of COMPONENTS) {
    it(`${name}_hostIsTransparentSoTheStripCanRightAlign`, () => {
      const styles: readonly string[] = stylesOf(component);

      expect(styles.length).toBeGreaterThan(0);
      expect(styles.join('\n').replace(/\s+/g, ' ')).toContain('display: contents;');
    });
  }
});
