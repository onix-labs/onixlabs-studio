import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Forge } from '@shared/angular/services/forge/forge';
import { ForgeProjects } from '@shared/angular/services/forge-projects/forge-projects';
import { Shell } from '@shared/angular/services/shell/shell';
import { ForgeRepositoryRef, ForgeResult, ForgeWorkItem } from '@shared/api/forge-types';
import { MissionControl } from '../../mission-control/mission-control';
import { MissionControlWorkItems } from '../work-items';
import { ago, MissionControlHierarchy } from './mission-control-hierarchy';

/**
 * The repository the tests open.
 */
const STUDIO: ForgeRepositoryRef = {
  kind: 'github',
  host: 'github.com',
  owner: 'onix-labs',
  name: 'onixlabs-studio',
};

/**
 * Builds an open work item.
 * @param number The issue number.
 * @param overrides The fields to set.
 * @returns Returns the work item.
 */
function item(number: number, overrides: Partial<ForgeWorkItem> = {}): ForgeWorkItem {
  return {
    number,
    title: `Issue ${number}`,
    url: `https://github.com/onix-labs/onixlabs-studio/issues/${number}`,
    labels: [],
    type: null,
    assignees: [],
    parent: null,
    children: { total: 0, completed: 0 },
    blockedBy: 0,
    authorTrusted: true,
    updatedAt: '2026-10-02T09:00:00Z',
    ...overrides,
  };
}

/**
 * The listing most tests read: an epic with two open features (one of them blocked) and one closed,
 * plus a standalone bug filed by an outsider.
 */
const LISTING: readonly ForgeWorkItem[] = [
  item(788, { labels: ['epic'], children: { total: 3, completed: 1 } }),
  item(789, { labels: ['feature'], parent: 788 }),
  item(795, { labels: ['feature'], parent: 788, blockedBy: 2 }),
  item(900, { title: 'A bug', authorTrusted: false }),
];

describe('ago', () => {
  const now: number = Date.parse('2026-10-02T12:00:00Z');

  it('describesRecencyCoarsely', () => {
    expect(ago('2026-10-02T11:59:40Z', now)).toBe('just now');
    expect(ago('2026-10-02T11:45:00Z', now)).toBe('15m ago');
    expect(ago('2026-10-02T09:00:00Z', now)).toBe('3h ago');
    expect(ago('2026-09-25T12:00:00Z', now)).toBe('7d ago');
    expect(ago('2026-06-01T12:00:00Z', now)).toBe('4mo ago');
  });

  it('saysNothing_forAnUnreadableTimestamp', () => {
    expect(ago('', now)).toBe('');
  });

  it('neverGoesNegative_whenTheClocksDisagree', () => {
    expect(ago('2026-10-02T12:05:00Z', now)).toBe('just now');
  });
});

describe('MissionControlHierarchy', () => {
  let fixture: ComponentFixture<MissionControlHierarchy>;
  let projects: ForgeProjects;
  let workItems: MissionControlWorkItems;
  let answer: ForgeResult<readonly ForgeWorkItem[]>;
  let opened: string[];

  /**
   * Gets the rendered rows' cells, one entry per row with its cells' text joined by spaces.
   * @returns Returns the rows.
   */
  function rows(): string[] {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const cells: string =
      '.tree-name, .tree-count, .mch__number, .mch__level, .mch__percent, .mch__updated, .mch__status';
    return [...host.querySelectorAll<HTMLElement>('.tree-row')].map((row: HTMLElement): string =>
      [...row.querySelectorAll<HTMLElement>(cells)]
        .filter((cell: HTMLElement): boolean => cell.querySelector(cells) === null)
        .map((cell: HTMLElement): string => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
        .join(' '),
    );
  }

  /**
   * Gets a rendered row by its tree id.
   * @param id The row's id.
   * @returns Returns the row.
   */
  function row(id: string): HTMLElement {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    return host.querySelector<HTMLElement>(`[data-tree-id="${id}"]`)!;
  }

  /**
   * Opens the project, reads its work items and renders.
   */
  async function load(): Promise<void> {
    projects.publish(STUDIO, '/dev/studio');
    TestBed.tick();
    workItems.setWatching(true);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    answer = { ok: true, value: LISTING };
    opened = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Forge,
          useValue: {
            workItems: (): Promise<ForgeResult<readonly ForgeWorkItem[]>> =>
              Promise.resolve(answer),
          },
        },
        {
          provide: Shell,
          useValue: {
            openExternal: (url: string): Promise<void> => {
              opened.push(url);
              return Promise.resolve();
            },
          },
        },
      ],
    });
    projects = TestBed.inject(ForgeProjects);
    workItems = TestBed.inject(MissionControlWorkItems);
    fixture = TestBed.createComponent(MissionControlHierarchy);
    (fixture.componentInstance as unknown as { now: () => number }).now = (): number =>
      Date.parse('2026-10-02T12:00:00Z');
    fixture.detectChanges();
  });

  afterEach(() => {
    workItems.setWatching(false);
  });

  it('saysSo_whenNoProjectIsOpen', () => {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('No projects open');
  });

  it('showsTheProjectsTree_withLevelsDerivedProgressAndRecency', async () => {
    await load();

    expect(rows()).toEqual([
      'onix-labs/onixlabs-studio 4',
      '#788 Issue 788 Epic 33% 3h ago',
      '#789 Issue 789 Feature 0% 3h ago',
      '#795 Issue 795 Feature 0% 3h ago',
    ]);
  });

  it('hidesStandaloneIssues_untilAskedFor', async () => {
    await load();
    expect(rows().some((text: string): boolean => text.includes('A bug'))).toBe(false);

    TestBed.inject(MissionControl).setShowStandalone(true);
    fixture.detectChanges();

    expect(rows().some((text: string): boolean => text.includes('A bug'))).toBe(true);
  });

  it('marksAnOutsidersIssue_andABlockedOne', async () => {
    TestBed.inject(MissionControl).setShowStandalone(true);
    await load();

    const prefix: string = 'item:github:github.com/onix-labs/onixlabs-studio';
    expect(row(`${prefix}#900`).querySelector('.mch__flag--untrusted')).not.toBeNull();
    expect(row(`${prefix}#795`).querySelector('.mch__flag--blocked')).not.toBeNull();
    expect(row(`${prefix}#789`).querySelector('.mch__flag')).toBeNull();
  });

  it('collapsesAndExpands_onClick', async () => {
    await load();
    const epic: string = 'item:github:github.com/onix-labs/onixlabs-studio#788';

    row(epic).click();
    fixture.detectChanges();
    expect(rows()).toHaveLength(2);

    row(epic).click();
    fixture.detectChanges();
    expect(rows()).toHaveLength(4);
  });

  it('opensAnItemOnTheForge_onDoubleClick', async () => {
    await load();

    row('item:github:github.com/onix-labs/onixlabs-studio#789').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );

    expect(opened).toEqual(['https://github.com/onix-labs/onixlabs-studio/issues/789']);
  });

  it('showsWhyTheReadFailed', async () => {
    answer = { ok: false, error: 'GitHub rejected the token.', unauthorized: true };

    await load();

    expect(rows()).toEqual(['onix-labs/onixlabs-studio', 'GitHub rejected the token.']);
  });

  it('saysSo_whenOnlyStandaloneIssuesAreOpen', async () => {
    answer = { ok: true, value: [item(1), item(2)] };

    await load();

    expect(rows()[1]).toBe('No epics. 2 standalone issues are hidden.');
  });
});
