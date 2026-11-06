import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { proposedOriginal } from './proposed-original';

describe('proposedOriginal', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proposed-original-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('proposedOriginal_ofAFile_answersItsText', async () => {
    const file: string = path.join(directory, 'a.txt');
    fs.writeFileSync(file, 'hello');

    expect(await proposedOriginal(file, null)).toBe('hello');
  });

  it('proposedOriginal_ofARelativePath_readsFromTheWorkspace', async () => {
    fs.writeFileSync(path.join(directory, 'a.txt'), 'hello');

    expect(await proposedOriginal('a.txt', directory)).toBe('hello');
  });

  it('proposedOriginal_ofAMissingFile_answersNull', async () => {
    expect(await proposedOriginal(path.join(directory, 'gone.txt'), null)).toBeNull();
  });

  it('proposedOriginal_ofADirectory_answersNull', async () => {
    expect(await proposedOriginal(directory, null)).toBeNull();
  });

  it('proposedOriginal_ofAFifo_answersNull_ratherThanWaitingForAWriterForever', async () => {
    const pipe: string = path.join(directory, 'pipe');
    execFileSync('mkfifo', [pipe]);

    expect(await proposedOriginal(pipe, null)).toBeNull();
  });
});
