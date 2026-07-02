import { TestBed } from '@angular/core/testing';

import { EditorTerminals } from '@shared/angular/services/editor-terminals/editor-terminals';
import { CodeRunner } from './code-runner';

describe('CodeRunner', () => {
  let runner: CodeRunner;
  let editorTerminals: EditorTerminals;

  beforeEach(() => {
    runner = TestBed.inject(CodeRunner);
    editorTerminals = TestBed.inject(EditorTerminals);
  });

  it('canRun_whenLanguageHasRunner_returnsTrue', () => {
    expect(runner.canRun('javascript')).toBe(true);
    expect(runner.canRun('python')).toBe(true);
  });

  it('canRun_whenLanguageHasNoRunner_returnsFalse', () => {
    expect(runner.canRun('plaintext')).toBe(false);
    expect(runner.canRun('markdown')).toBe(false);
  });

  it('run_whenOutsideElectron_doesNotQueueACommand', async () => {
    await runner.run('tab-1', 'javascript', 'console.log(1)');
    expect(editorTerminals.isVisible('tab-1')).toBe(false);
  });
});
