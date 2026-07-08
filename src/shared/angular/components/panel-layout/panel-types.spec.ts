import {
  movePanel,
  normalizeOrders,
  PANEL_EDGE_GUIDE_INSET,
  PANEL_EDGE_GUIDE_SIZE,
  PANEL_EDGE_THRESHOLD,
  PanelArrangement,
  panelEdgeGuideRect,
  panelEdgePreview,
  PanelRect,
  resizeEdgePanels,
  resolvePanelEdgeGuideTarget,
  resolvePanelEdgeTarget,
  restorePanelArrangement,
} from './panel-types';

const WORKSPACE: PanelRect = { left: 100, top: 50, width: 800, height: 600 };

describe('resolvePanelEdgeTarget', () => {
  it('resolve_whenCursorIsWithinTheBorderBand_targetsTheNearestEdge', () => {
    expect(resolvePanelEdgeTarget(100 + PANEL_EDGE_THRESHOLD, 350, WORKSPACE)).toBe('left');
    expect(resolvePanelEdgeTarget(900 - PANEL_EDGE_THRESHOLD, 350, WORKSPACE)).toBe('right');
    expect(resolvePanelEdgeTarget(500, 50 + PANEL_EDGE_THRESHOLD, WORKSPACE)).toBe('top');
    expect(resolvePanelEdgeTarget(500, 650 - PANEL_EDGE_THRESHOLD, WORKSPACE)).toBe('bottom');
  });

  it('resolve_whenCursorIsInsideTheBandlessCentre_returnsNull', () => {
    expect(resolvePanelEdgeTarget(500, 350, WORKSPACE)).toBeNull();
  });

  it('resolve_whenCursorIsOutsideTheWorkspace_returnsNull', () => {
    expect(resolvePanelEdgeTarget(50, 350, WORKSPACE)).toBeNull();
    expect(resolvePanelEdgeTarget(500, 700, WORKSPACE)).toBeNull();
  });
});

describe('resolvePanelEdgeGuideTarget', () => {
  it('resolve_whenCursorIsOverAGuideSquare_targetsItsEdge', () => {
    const guide: PanelRect = panelEdgeGuideRect('left', WORKSPACE);
    const x: number = guide.left + guide.width / 2;
    const y: number = guide.top + guide.height / 2;

    expect(resolvePanelEdgeGuideTarget(x, y, WORKSPACE)).toBe('left');
  });

  it('resolve_whenCursorIsOverNoGuide_returnsNull', () => {
    expect(resolvePanelEdgeGuideTarget(500, 350, WORKSPACE)).toBeNull();
  });
});

describe('panelEdgeGuideRect', () => {
  it('rect_isInsetFromItsBorderAndCentredAlongIt', () => {
    const rect: PanelRect = panelEdgeGuideRect('right', WORKSPACE);

    expect(rect.left).toBe(100 + 800 - PANEL_EDGE_GUIDE_INSET - PANEL_EDGE_GUIDE_SIZE);
    expect(rect.top).toBe(50 + 300 - PANEL_EDGE_GUIDE_SIZE / 2);
    expect(rect.width).toBe(PANEL_EDGE_GUIDE_SIZE);
    expect(rect.height).toBe(PANEL_EDGE_GUIDE_SIZE);
  });
});

describe('panelEdgePreview', () => {
  it('preview_forAVerticalEdge_spansTheFullHeightAtACappedThickness', () => {
    const preview: PanelRect = panelEdgePreview('left', WORKSPACE);

    expect(preview.left).toBe(100);
    expect(preview.top).toBe(50);
    expect(preview.height).toBe(600);
    expect(preview.width).toBe(Math.min(280, 800 * 0.32));
  });

  it('preview_forTheBottomEdge_hugsTheBottomBorder', () => {
    const preview: PanelRect = panelEdgePreview('bottom', WORKSPACE);

    expect(preview.width).toBe(800);
    expect(preview.top + preview.height).toBe(50 + 600);
  });
});

describe('restorePanelArrangement', () => {
  it('restore_whenTheValueIsNotARecord_returnsEmpty', () => {
    expect(restorePanelArrangement(null)).toEqual({});
    expect(restorePanelArrangement('garbage')).toEqual({});
    expect(restorePanelArrangement([1, 2])).toEqual({});
  });

  it('restore_dropsMalformedEntriesAndKeepsValidOnes', () => {
    const restored: PanelArrangement = restorePanelArrangement({
      agent: { edge: 'right', order: 0, size: 360 },
      badEdge: { edge: 'centre', order: 0, size: 100 },
      badSize: { edge: 'left', order: 0, size: -5 },
      badOrder: { edge: 'left', order: 'first', size: 100 },
      notAnObject: 42,
    });

    expect(Object.keys(restored)).toEqual(['agent']);
    expect(restored['agent']).toEqual({ edge: 'right', order: 0, size: 360 });
  });

  it('restore_normalizesEachEdgesOrdersToADenseSequence', () => {
    const restored: PanelArrangement = restorePanelArrangement({
      a: { edge: 'right', order: 7, size: 100 },
      b: { edge: 'right', order: 3, size: 100 },
      c: { edge: 'bottom', order: 9, size: 100 },
    });

    expect(restored['b'].order).toBe(0);
    expect(restored['a'].order).toBe(1);
    expect(restored['c'].order).toBe(0);
  });
});

describe('movePanel', () => {
  const arrangement: PanelArrangement = {
    terminal: { edge: 'bottom', order: 0, size: 240 },
    agent: { edge: 'right', order: 0, size: 360 },
    find: { edge: 'right', order: 1, size: 320 },
  };

  it('move_appendsThePanelAtTheEndOfTheTargetEdgeAndRenormalizesTheSource', () => {
    const moved: PanelArrangement = movePanel(arrangement, 'agent', 'bottom');

    expect(moved['agent'].edge).toBe('bottom');
    expect(moved['agent'].order).toBe(1);
    expect(moved['agent'].size).toBe(360);
    // The vacated right edge renormalizes to a dense sequence.
    expect(moved['find'].order).toBe(0);
  });

  it('move_toThePanelsOwnEdge_movesItToTheEndOfTheStack', () => {
    const moved: PanelArrangement = movePanel(arrangement, 'agent', 'right');

    expect(moved['find'].order).toBe(0);
    expect(moved['agent'].order).toBe(1);
  });

  it('move_ofAnUnplacedPanel_isIgnored', () => {
    expect(movePanel(arrangement, 'unknown', 'left')).toBe(arrangement);
  });
});

describe('resizeEdgePanels', () => {
  it('resize_writesEveryPanelOnTheEdgeAndNoOther', () => {
    const resized: PanelArrangement = resizeEdgePanels(
      {
        agent: { edge: 'right', order: 0, size: 360 },
        find: { edge: 'right', order: 1, size: 320 },
        terminal: { edge: 'bottom', order: 0, size: 240 },
      },
      'right',
      400,
    );

    expect(resized['agent'].size).toBe(400);
    expect(resized['find'].size).toBe(400);
    expect(resized['terminal'].size).toBe(240);
  });
});

describe('normalizeOrders', () => {
  it('normalize_preservesRelativeOrderWithinEachEdge', () => {
    const normalized: PanelArrangement = normalizeOrders({
      a: { edge: 'left', order: 5, size: 100 },
      b: { edge: 'left', order: 2, size: 100 },
    });

    expect(normalized['b'].order).toBe(0);
    expect(normalized['a'].order).toBe(1);
  });
});
