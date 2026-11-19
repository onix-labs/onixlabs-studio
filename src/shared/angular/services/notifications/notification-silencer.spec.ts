import { TestBed } from '@angular/core/testing';
import { SettingsNavigation } from '@shared/angular/services/settings-navigation/settings-navigation';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { NotificationSilencer } from './notification-silencer';
import { NotificationTypes, provideNotificationTypes } from './notification-types';
import { Notification, NotificationRequest, Notifications } from './notifications';

describe('NotificationSilencer (#1487)', () => {
  let silencer: NotificationSilencer;
  let types: NotificationTypes;
  let raised: NotificationRequest[];
  let opened: { section: string; focus: string | undefined }[];

  /**
   * Builds a raised notification for a test.
   * @param type Its type, or undefined for feedback on something the user did.
   * @returns Returns the notification.
   */
  function raisedOf(type: string | undefined): Notification {
    return {
      id: 1,
      severity: 'error',
      title: 'postgres exited (code 1)',
      actions: [],
      sticky: false,
      timestamp: 0,
      ...(type === undefined ? {} : { type }),
    };
  }

  beforeEach(() => {
    raised = [];
    opened = [];
    TestBed.configureTestingModule({
      providers: [
        provideNotificationTypes([
          {
            id: 'containers.exited',
            label: 'Container Exited',
            description: 'A container stopped on its own.',
            area: 'Containers',
            default: 'popup',
          },
        ]),
        {
          provide: Notifications,
          useValue: { notify: (request: NotificationRequest): number => raised.push(request) },
        },
        {
          provide: SettingsNavigation,
          useValue: {
            open: (section: string, focus?: string): number => opened.push({ section, focus }),
          },
        },
        { provide: Tabs, useValue: {} },
      ],
    });
    silencer = TestBed.inject(NotificationSilencer);
    types = TestBed.inject(NotificationTypes);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('isOffered_forATypeThatPopsUp_andNotForFeedback', () => {
    expect(silencer.canSilence(raisedOf('containers.exited'))).toBe(true);
    expect(silencer.canSilence(raisedOf(undefined))).toBe(false);
    expect(silencer.canConfigure(raisedOf(undefined))).toBe(false);
  });

  it('isNotOffered_onceTheTypeGoesToTheHistoryOnly', () => {
    types.set('containers.exited', 'history');

    expect(silencer.canSilence(raisedOf('containers.exited'))).toBe(false);
    expect(silencer.canConfigure(raisedOf('containers.exited'))).toBe(true);
  });

  it('silence_sendsTheTypeToTheHistoryOnly_andSaysSoWithUndo', () => {
    silencer.silence(raisedOf('containers.exited'));

    expect(types.shown('containers.exited')).toBe('history');
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ title: 'Container Exited turned off' });
    // The notice is feedback on what the user just did: it has no type to switch off in turn.
    expect(raised[0].type).toBeUndefined();
  });

  it('undo_putsBackTheChoiceItHad', () => {
    silencer.silence(raisedOf('containers.exited'));

    raised[0].actions?.find((action) => action.label === 'Undo')?.run();

    expect(types.shown('containers.exited')).toBe('popup');
  });

  it('configure_opensSettingsAtTheType', () => {
    silencer.configure(raisedOf('containers.exited'));

    expect(opened).toEqual([{ section: 'notifications', focus: 'containers.exited' }]);
  });

  it('silence_ofFeedback_doesNothing', () => {
    silencer.silence(raisedOf(undefined));

    expect(raised).toEqual([]);
  });
});
