import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { AiWorkspaceExclusions } from '@shared/api/ai-types';
import { AgentExclusions } from '@shared/angular/services/agent-exclusions/agent-exclusions';
import { Settings } from '@shared/angular/services/settings/settings';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { AiExcludedCommands } from './ai-excluded-commands';

const ROOT: string = '/work/studio';

describe('AiExcludedCommands', () => {
  let fixture: ComponentFixture<AiExcludedCommands>;
  let lists: WritableSignal<ReadonlyMap<string, AiWorkspaceExclusions>>;
  let calls: string[];

  /**
   * Builds the editor for a workspace with the given lists.
   * @param workspace The focused workspace's lists.
   * @param root The focused workspace, or null for none.
   * @returns Returns the host element.
   */
  async function build(
    workspace: Partial<AiWorkspaceExclusions> = {},
    root: string | null = ROOT,
  ): Promise<HTMLElement> {
    localStorage.clear();
    calls = [];
    lists = signal<ReadonlyMap<string, AiWorkspaceExclusions>>(
      new Map<string, AiWorkspaceExclusions>([
        [
          ROOT,
          { workspaceRoot: ROOT, private: [], shared: [], sharedReviewed: false, ...workspace },
        ],
      ]),
    );
    TestBed.configureTestingModule({
      imports: [AiExcludedCommands],
      providers: [
        { provide: ActiveWorkspace, useValue: { rootPath: signal<string | null>(root) } },
        {
          provide: AgentExclusions,
          useValue: {
            all: lists,
            refresh: (): Promise<void> => Promise.resolve(),
            setPrivate: (_root: string, patterns: readonly string[]): Promise<void> => {
              calls.push(`private ${patterns.join(',')}`);
              return Promise.resolve();
            },
            setShared: (patterns: readonly string[]): Promise<void> => {
              calls.push(`shared ${patterns.join(',')}`);
              return Promise.resolve();
            },
            review: (_root: string, patterns: readonly string[]): Promise<void> => {
              calls.push(`review ${patterns.join(',')}`);
              return Promise.resolve();
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(AiExcludedCommands);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Types into a list's field and presses its Add button.
   * @param host The editor.
   * @param group Which group, in page order.
   * @param text What to type.
   */
  async function add(host: HTMLElement, group: number, text: string): Promise<void> {
    const section: Element = host.querySelectorAll('.excluded-commands__group')[group];
    const input: HTMLInputElement = section.querySelector('input')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    [...section.querySelectorAll<HTMLButtonElement>('button')]
      .find((button: HTMLButtonElement): boolean => button.textContent?.trim() === 'Add')
      ?.click();
    await fixture.whenStable();
  }

  it('addsToTheGlobalList_inItsCanonicalForm', async () => {
    const host: HTMLElement = await build();

    await add(host, 0, '  npx   ng :* ');

    expect(TestBed.inject(Settings).aiExcludedCommands()).toEqual(['npx ng:*']);
  });

  it('refusesAPatternThatNamesNoCommand_andSaysWhy', async () => {
    const host: HTMLElement = await build();

    await add(host, 0, '*');

    expect(TestBed.inject(Settings).aiExcludedCommands()).toEqual([]);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('is not a command pattern');
  });

  it('addsToThisWorkspacesPrivateAndSharedLists', async () => {
    const host: HTMLElement = await build();

    await add(host, 1, 'dotnet:*');
    await add(host, 2, 'make build');

    expect(calls).toEqual(['private dotnet:*', 'shared make build']);
  });

  it('saysASharedListIsIgnoredUntilAllowed_andAllowsIt', async () => {
    const host: HTMLElement = await build({ shared: ['make build'] });

    expect(host.textContent).toContain('Not allowed yet');
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button: HTMLButtonElement): boolean => button.textContent?.trim() === 'Allow')
      ?.click();

    expect(calls).toEqual(['review make build']);
  });

  it('saysAReviewedSharedListApplies', async () => {
    const host: HTMLElement = await build({ shared: ['make build'], sharedReviewed: true });

    expect(host.textContent).toContain('Allowed: these apply');
  });

  it('showsOnlyTheGlobalList_withNoWorkspaceOpen', async () => {
    const host: HTMLElement = await build({}, null);

    expect(host.querySelectorAll('.excluded-commands__group').length).toBe(1);
  });
});
