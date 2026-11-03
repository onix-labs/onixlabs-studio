import { TestBed } from '@angular/core/testing';

import { Settings } from '@shared/angular/services/settings/settings';
import { EDITOR_ZOOM_LEVELS, EditorZoom } from './editor-zoom';

describe('EditorZoom', () => {
  afterEach(() => {
    localStorage.removeItem('settings');
  });

  let zoom: EditorZoom;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    zoom = TestBed.inject(EditorZoom);
  });

  it('percent_beforeAnyChange_defaultsToOneHundred', () => {
    expect(zoom.percent()).toBe(100);
  });

  it('levels_exposesTheSelectableRange', () => {
    expect(zoom.levels).toEqual(EDITOR_ZOOM_LEVELS);
  });

  it('set_whenWithinTheRange_appliesTheLevel', () => {
    zoom.set(150);

    expect(zoom.percent()).toBe(150);
  });

  it('set_whenBelowTheMinimum_clampsToTheSmallestLevel', () => {
    zoom.set(5);

    expect(zoom.percent()).toBe(EDITOR_ZOOM_LEVELS[0]);
  });

  it('set_whenAboveTheMaximum_clampsToTheLargestLevel', () => {
    zoom.set(400);

    expect(zoom.percent()).toBe(EDITOR_ZOOM_LEVELS[EDITOR_ZOOM_LEVELS.length - 1]);
  });

  it('set_remembersTheLevelInTheSettings', () => {
    zoom.set(150);

    expect(TestBed.inject(Settings).get('textEditor.zoom')).toBe(150);
  });

  it('step_movesToTheNextLevelEachWay', () => {
    zoom.step(1);
    expect(zoom.percent()).toBe(125);

    zoom.step(-1);
    zoom.step(-1);
    expect(zoom.percent()).toBe(75);
  });

  it('step_atEitherEnd_staysPut', () => {
    zoom.set(200);
    zoom.step(1);
    expect(zoom.percent()).toBe(200);

    zoom.set(25);
    zoom.step(-1);
    expect(zoom.percent()).toBe(25);
  });
});
