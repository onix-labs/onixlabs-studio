import { TestBed } from '@angular/core/testing';

import { EDITOR_ZOOM_LEVELS, EditorZoom } from './editor-zoom';

describe('EditorZoom', () => {
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
});
