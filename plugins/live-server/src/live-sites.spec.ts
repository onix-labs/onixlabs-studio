import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveSite } from './live-site';
import { LiveSites } from './live-sites';
import { LIVE_SERVER_PROTOCOL } from './protocol';

describe('LiveSites (#1062)', () => {
  let scratch: string = '';

  beforeAll(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'live-server-sites-')));
    fs.writeFileSync(path.join(scratch, 'file.txt'), '');
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('answers_theHandshake', async () => {
    expect(await new LiveSites().answer('initialize', {})).toEqual({
      protocol: LIVE_SERVER_PROTOCOL,
    });
  });

  it('serves_aFolder_andStopsIt', async () => {
    const sites: LiveSites = new LiveSites((root: string) => new LiveSite(root, () => null));

    const serving: unknown = await sites.answer('serve', { root: scratch, port: 0 });
    const serverId: unknown = (serving as { serverId: unknown }).serverId;
    const port: unknown = (serving as { port: unknown }).port;

    expect(typeof serverId).toBe('string');
    expect(typeof port).toBe('number');
    expect(await sites.answer('stop', { serverId })).toEqual({});
    expect(await sites.answer('stop', { serverId: 'unknown' })).toEqual({});
    await sites.closeAll();
  });

  it.each<[string, unknown]>([
    ['not text', 7],
    ['relative', 'site'],
    ['a file', 'file.txt'],
  ])('refuses_toServe_aFolderThatIs %s', async (_name: string, root: unknown) => {
    const sites: LiveSites = new LiveSites((folder: string) => new LiveSite(folder, () => null));
    const given: unknown = root === 'file.txt' ? path.join(scratch, 'file.txt') : root;

    await expect(sites.answer('serve', { root: given, port: 0 })).rejects.toThrow();
  });

  it.each<[string, unknown, number | undefined]>([
    ['none asked for', undefined, undefined],
    ['the interval asked for', 2000, 2000],
    ['a clamped interval', 5, 250],
    ['none, for nonsense', 'often', undefined],
  ])('creates_eachSite_polledAt %s', async (_name: string, asked: unknown, given: unknown) => {
    const intervals: (number | undefined)[] = [];
    const sites: LiveSites = new LiveSites(
      (root: string, pollIntervalMs: number | undefined): LiveSite => {
        intervals.push(pollIntervalMs);
        return new LiveSite(root, () => null);
      },
    );

    await sites.answer('serve', { root: scratch, port: 0, pollIntervalMs: asked });
    await sites.closeAll();

    expect(intervals).toEqual([given]);
  });

  it('refuses_anUnknownOperation', async () => {
    await expect(new LiveSites().answer('listDirectory', {})).rejects.toThrow('Unknown operation');
  });
});
