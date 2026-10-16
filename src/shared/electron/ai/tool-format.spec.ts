import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { summarizeToolInput } = await import('./tool-format');

describe('summarizeToolInput', () => {
  it('surfacesTheMostDescriptiveField_mostSpecificFirst', () => {
    expect(summarizeToolInput({ command: 'ls', description: 'list' })).toBe('ls');
    expect(summarizeToolInput({ description: 'short', prompt: 'a long delegated prompt' })).toBe(
      'short',
    );
    expect(summarizeToolInput({ file_path: '/a.ts', path: '/b.ts' })).toBe('/a.ts');
  });

  it('namesWhatATollViewToolActsOn', () => {
    // #969: an image to pull, a container to remove, a model to download, a level to set. Each used
    // to summarise as nothing, and the permission card asked the user to allow it blind.
    expect(summarizeToolInput({ reference: 'postgres:16' })).toBe('postgres:16');
    expect(summarizeToolInput({ id: 'db' })).toBe('db');
    expect(summarizeToolInput({ name: 'pgdata' })).toBe('pgdata');
    expect(summarizeToolInput({ ref: 'qwen3:8b' })).toBe('qwen3:8b');
    expect(summarizeToolInput({ level: 'debug' })).toBe('debug');
    expect(summarizeToolInput({ image: 'nginx', name: 'web' })).toBe('nginx');
  });

  it('fallsBackToTheWholeInput_soNothingIsApprovedUnseen', () => {
    expect(summarizeToolInput({ host: 8080, container: 80 })).toBe('{"host":8080,"container":80}');
    expect(summarizeToolInput({ only: undefined })).toBe('');
    expect(summarizeToolInput({})).toBe('');
    expect(summarizeToolInput('text')).toBe('');
    expect(summarizeToolInput(null)).toBe('');
  });

  it('clampsALongSummaryToOneLine', () => {
    const long: string = 'x'.repeat(200);
    expect(summarizeToolInput({ command: long })).toHaveLength(120);
    expect(summarizeToolInput({ command: long }).endsWith('...')).toBe(true);
    expect(summarizeToolInput({ blob: long })).toHaveLength(120);
  });
});
