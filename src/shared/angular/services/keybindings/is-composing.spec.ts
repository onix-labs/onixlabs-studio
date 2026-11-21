import { describe, expect, it } from 'vitest';
import { isComposing } from './is-composing';

describe('isComposing', () => {
  it('reads a press during a composition as the input method’s', () => {
    expect(isComposing(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))).toBe(
      true,
    );
  });

  it('reads the press that opens a composition as the input method’s', () => {
    expect(isComposing(new KeyboardEvent('keydown', { key: 'Process', keyCode: 229 }))).toBe(true);
  });

  it('reads a plain press as the user’s', () => {
    expect(isComposing(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false);
  });
});
