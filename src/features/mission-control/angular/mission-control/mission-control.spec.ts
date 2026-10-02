import { TestBed } from '@angular/core/testing';

import { MissionControl } from './mission-control';

describe('MissionControl', () => {
  let missionControl: MissionControl;

  beforeEach(() => {
    missionControl = TestBed.inject(MissionControl);
  });

  it('showsTheAgents_untilAnotherFaceIsChosen', () => {
    expect(missionControl.face()).toBe('agents');

    missionControl.setFace('hierarchy');

    expect(missionControl.face()).toBe('hierarchy');
  });

  it('hidesStandaloneIssues_untilAskedFor', () => {
    expect(missionControl.showStandalone()).toBe(false);

    missionControl.setShowStandalone(true);

    expect(missionControl.showStandalone()).toBe(true);
  });
});
