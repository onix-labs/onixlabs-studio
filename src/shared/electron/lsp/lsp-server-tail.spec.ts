import { describe, expect, it } from 'vitest';
import { LspServerTail } from './lsp-server-tail';

describe('LspServerTail', () => {
  it('summary_isTheServersLastLoggedError_firstLineOnly', () => {
    const tail: LspServerTail = new LspServerTail();
    tail.logMessage({ type: 3, message: 'Successfully completed load of A.csproj' });
    tail.logMessage({
      type: 1,
      message:
        'System.InvalidOperationException: didOpen received for file:///a/B.cs which is already open.\n   at Microsoft.CodeAnalysis.Contract.Fail(String message)',
    });
    tail.logMessage({ type: 3, message: 'Error occurred processing queue: didOpen received …' });

    expect(tail.summary()).toBe(
      'System.InvalidOperationException: didOpen received for file:///a/B.cs which is already open.',
    );
    // Information-level chatter is not kept; the error is, as one line.
    expect(tail.recent()).toEqual([
      'error: System.InvalidOperationException: didOpen received for file:///a/B.cs which is already open.',
    ]);
  });

  it('summary_fallsBackToTheLastLineOfStderr_andJoinsSplitChunks', () => {
    const tail: LspServerTail = new LspServerTail();
    tail.stderr('Unhandled exce');
    tail.stderr('ption. System.OutOfMemoryException\n   at X.Y()\n');

    expect(tail.recent()).toEqual([
      'stderr: Unhandled exception. System.OutOfMemoryException',
      'stderr:    at X.Y()',
    ]);
    expect(tail.summary()).toBe('at X.Y()');
  });

  it('summary_isNull_forAServerThatSaidNothing_andWarningsAreKeptButNotPreferred', () => {
    const tail: LspServerTail = new LspServerTail();
    expect(tail.summary()).toBeNull();
    expect(tail.recent()).toEqual([]);

    tail.logMessage({ type: 2, message: 'Project X has unresolved dependencies' });
    expect(tail.recent()).toEqual(['warning: Project X has unresolved dependencies']);
    expect(tail.summary()).toBeNull();

    tail.logMessage(null);
    tail.logMessage({ type: 1, message: 42 });
    expect(tail.recent()).toHaveLength(1);
  });

  it('recent_keepsOnlyTheLastFortyLines_andAnUnfinishedStderrLine', () => {
    const tail: LspServerTail = new LspServerTail();
    for (let index: number = 0; index < 50; index += 1) {
      tail.stderr(`line ${index}\n`);
    }
    tail.stderr('partial');

    const recent: readonly string[] = tail.recent();
    expect(recent).toHaveLength(41);
    expect(recent[0]).toBe('stderr: line 10');
    expect(recent.at(-1)).toBe('stderr: partial');
    expect(tail.summary()).toBe('partial');
  });

  it('summary_isCappedToOneReadableLine', () => {
    const tail: LspServerTail = new LspServerTail();
    tail.logMessage({ type: 1, message: 'x'.repeat(500) });

    expect(tail.summary()?.length).toBe(240);
    expect(tail.summary()?.endsWith('…')).toBe(true);
  });
});
