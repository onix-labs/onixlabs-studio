import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { AiClient } from '@shared/api/ai-channels';
import type { AiSetWorkspaceExclusions, AiWorkspaceExclusions } from '@shared/api/ai-types';
import { Ai } from '@shared/angular/services/ai/ai';
import { StudioConfig } from '@shared/angular/services/studio/studio-config';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { AgentExclusions } from './agent-exclusions';

const ROOT: string = '/work/studio';

describe('AgentExclusions', () => {
  let lists: AiWorkspaceExclusions;
  let calls: string[];
  let sharedWrites: (readonly string[])[];
  let root: WritableSignal<string | null>;

  /**
   * Builds the service over a fake main process that holds one workspace's lists.
   * @returns Returns the service.
   */
  function service(): AgentExclusions {
    lists = { workspaceRoot: ROOT, private: [], shared: [], sharedReviewed: false };
    calls = [];
    sharedWrites = [];
    root = signal<string | null>(ROOT);
    const client: Partial<AiClient> = {
      getWorkspaceExclusions: (): Promise<AiWorkspaceExclusions> => Promise.resolve(lists),
      setPrivateExclusions: (request: AiSetWorkspaceExclusions): Promise<AiWorkspaceExclusions> => {
        calls.push(`private ${request.patterns.join(',')}`);
        lists = { ...lists, private: request.patterns };
        return Promise.resolve(lists);
      },
      reviewSharedExclusions: (
        request: AiSetWorkspaceExclusions,
      ): Promise<AiWorkspaceExclusions> => {
        calls.push(`review ${request.patterns.join(',')}`);
        lists = { ...lists, sharedReviewed: true };
        return Promise.resolve(lists);
      },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: Ai, useValue: { client } },
        {
          provide: StudioConfig,
          useValue: {
            saveExcludedCommands: (patterns: readonly string[]): Promise<void> => {
              sharedWrites.push(patterns);
              lists = { ...lists, shared: patterns };
              return Promise.resolve();
            },
          },
        },
        { provide: ActiveWorkspace, useValue: { rootPath: root } },
      ],
    });
    return TestBed.inject(AgentExclusions);
  }

  it('excludeForWorkspace_addsToThePrivateList_once', async () => {
    const exclusions: AgentExclusions = service();
    lists = { ...lists, private: ['dotnet:*'] };

    await exclusions.excludeForWorkspace(ROOT, 'npx ng:*');
    await exclusions.excludeForWorkspace(ROOT, 'npx ng:*');

    expect(calls).toEqual(['private dotnet:*,npx ng:*', 'private dotnet:*,npx ng:*']);
    expect(exclusions.of(ROOT)?.private).toEqual(['dotnet:*', 'npx ng:*']);
  });

  it('pendingReview_offersAnUnreviewedSharedList_untilAllowedOrPutOff', async () => {
    const exclusions: AgentExclusions = service();
    lists = { ...lists, shared: ['make build'] };
    await exclusions.refresh(ROOT);

    expect(exclusions.pendingReview(ROOT)).toEqual(['make build']);
    expect(exclusions.pendingReview(null)).toEqual([]);

    exclusions.snooze(ROOT);
    expect(exclusions.pendingReview(ROOT)).toEqual([]);
  });

  it('review_letsTheSharedListApply', async () => {
    const exclusions: AgentExclusions = service();
    lists = { ...lists, shared: ['make build'] };
    await exclusions.refresh(ROOT);

    await exclusions.review(ROOT, ['make build']);

    expect(calls).toEqual(['review make build']);
    expect(exclusions.pendingReview(ROOT)).toEqual([]);
  });

  it('setShared_writesTheTeamsList_andCountsAsReviewingIt', async () => {
    // The user wrote it, so it applies at once rather than asking them to allow their own list.
    const exclusions: AgentExclusions = service();

    await exclusions.setShared(['npm run e2e:*', '*']);

    expect(sharedWrites).toEqual([['npm run e2e:*']]);
    expect(calls).toEqual(['review npm run e2e:*']);
  });

  it('setShared_withNoFocusedWorkspace_writesNothing', async () => {
    const exclusions: AgentExclusions = service();
    root.set(null);

    await exclusions.setShared(['make build']);

    expect(sharedWrites).toEqual([]);
  });
});
