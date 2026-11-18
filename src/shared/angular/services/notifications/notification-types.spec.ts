import { TestBed } from '@angular/core/testing';
import { Settings } from '@shared/angular/services/settings/settings';

import {
  NotificationArea,
  NotificationTypeDef,
  NotificationTypes,
  provideNotificationTypes,
} from './notification-types';

/**
 * Builds a notification type for a test.
 * @param id The type identifier.
 * @param area The area it belongs to.
 * @param fallback Its default choice.
 * @returns Returns the type.
 */
function typeOf(
  id: string,
  area: string,
  fallback: NotificationTypeDef['default'],
): NotificationTypeDef {
  return { id, label: id, description: `${id} happened.`, area, default: fallback };
}

describe('NotificationTypes', () => {
  let types: NotificationTypes;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideNotificationTypes([
          typeOf('tests.finished', 'Tests', 'history'),
          typeOf('tests.failed', 'Tests', 'popup'),
        ]),
        provideNotificationTypes([typeOf('downloads.finished', 'Downloads', 'popup')]),
      ],
    });
    types = TestBed.inject(NotificationTypes);
  });

  afterEach(() => {
    // Settings persist through localStorage; one test's choice must not reach the next.
    localStorage.clear();
  });

  it('choice_withoutAStoredChoice_isTheTypesDefault', () => {
    expect(types.choice('tests.finished')).toBe('history');
    expect(types.choice('tests.failed')).toBe('popup');
  });

  it('choice_forAnUnknownType_popsUp', () => {
    expect(types.choice('nobody.contributed')).toBe('popup');
  });

  it('set_storesOnlyChoicesThatDifferFromTheDefault', () => {
    types.set('tests.finished', 'off');
    types.set('tests.failed', 'popup');

    expect(TestBed.inject(Settings).get('notifications.types')).toEqual({
      'tests.finished': 'off',
    });
    expect(types.choice('tests.finished')).toBe('off');
    expect(types.changed()).toBe(true);
  });

  it('set_backToTheDefault_removesTheStoredChoice', () => {
    types.set('tests.finished', 'off');
    types.set('tests.finished', 'history');

    expect(TestBed.inject(Settings).get('notifications.types')).toEqual({});
    expect(types.changed()).toBe(false);
  });

  it('resetAll_returnsEveryTypeToItsDefault', () => {
    types.set('tests.finished', 'off');
    types.set('downloads.finished', 'history');

    types.resetAll();

    expect(types.choice('tests.finished')).toBe('history');
    expect(types.choice('downloads.finished')).toBe('popup');
  });

  it('areas_groupTheTypesAlphabeticallyByArea', () => {
    const areas: readonly string[] = types
      .areas()
      .map((group: NotificationArea): string => group.area);

    expect(areas).toEqual(['Agents', 'Cloning', 'Downloads', 'Runs and Builds', 'Tests']);
    expect(
      types
        .areas()
        .find((group: NotificationArea): boolean => group.area === 'Tests')
        ?.types.map((type: NotificationTypeDef): string => type.id),
    ).toEqual(['tests.finished', 'tests.failed']);
  });

  it('contribute_addsNewTypesAndIgnoresKnownOnes', () => {
    types.contribute([
      typeOf('tests.finished', 'Elsewhere', 'off'),
      typeOf('models.pullFinished', 'Local Models', 'popup'),
    ]);

    const ids: readonly string[] = types.all().map((type: NotificationTypeDef): string => type.id);
    expect(ids.filter((id: string): boolean => id === 'tests.finished')).toHaveLength(1);
    expect(ids).toContain('models.pullFinished');
    expect(types.choice('tests.finished')).toBe('history');
  });

  it('all_includesTheSharedServicesOwnTypes', () => {
    const ids: readonly string[] = types.all().map((type: NotificationTypeDef): string => type.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        'agent.finished',
        'agent.failed',
        'run.finished',
        'run.failed',
        'build.finished',
        'build.failed',
        'clone.finished',
        'clone.failed',
      ]),
    );
  });

  it('aTypeProvidedTwice_isListedOnce', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideNotificationTypes([typeOf('agent.finished', 'Elsewhere', 'off')]),
        provideNotificationTypes([typeOf('x.done', 'X', 'popup'), typeOf('x.done', 'X', 'off')]),
      ],
    });
    const fresh: NotificationTypes = TestBed.inject(NotificationTypes);

    const ids: readonly string[] = fresh.all().map((type: NotificationTypeDef): string => type.id);
    expect(ids.filter((id: string): boolean => id === 'agent.finished')).toHaveLength(1);
    expect(ids.filter((id: string): boolean => id === 'x.done')).toHaveLength(1);
    expect(fresh.choice('agent.finished')).toBe('popup');
    expect(fresh.choice('x.done')).toBe('popup');
  });
});
