import {
  DockResolution,
  guideLegality,
  nearestEdge,
  Rect,
  resolveCompassTarget,
  resolveEdgeGuideTarget,
  resolveEdgeTarget,
  resolveGroupTarget,
} from './dock-legality';

describe('dock-legality', () => {
  const workspace: Rect = { left: 0, top: 0, width: 1000, height: 800 };
  const group: Rect = { left: 100, top: 100, width: 200, height: 200 };

  describe('guideLegality', () => {
    it('guideLegality_whenDocumentOverDocument_allowsEveryGuide', () => {
      expect(guideLegality('document', 'document')).toEqual({
        center: true,
        left: true,
        right: true,
        top: true,
        bottom: true,
      });
    });

    it('guideLegality_whenDocumentOverTool_forbidsEveryGuide', () => {
      expect(guideLegality('document', 'tool')).toEqual({
        center: false,
        left: false,
        right: false,
        top: false,
        bottom: false,
      });
    });

    it('guideLegality_whenToolOverDocument_allowsSplitsButNotTabInto', () => {
      expect(guideLegality('tool', 'document')).toEqual({
        center: false,
        left: true,
        right: true,
        top: true,
        bottom: true,
      });
    });

    it('guideLegality_whenToolOverTool_allowsEveryGuide', () => {
      expect(guideLegality('tool', 'tool').center).toBe(true);
    });
  });

  describe('resolveEdgeTarget', () => {
    it('resolveEdgeTarget_whenToolNearLeftBorder_targetsTheLeftEdge', () => {
      const resolution: DockResolution | null = resolveEdgeTarget(5, 400, workspace, 'tool');

      expect(resolution?.target).toEqual({ kind: 'edge', side: 'left' });
      expect(resolution?.preview.left).toBe(0);
    });

    it('resolveEdgeTarget_whenDocument_returnsNull', () => {
      expect(resolveEdgeTarget(5, 400, workspace, 'document')).toBeNull();
    });

    it('resolveEdgeTarget_whenAwayFromEveryBorder_returnsNull', () => {
      expect(resolveEdgeTarget(500, 400, workspace, 'tool')).toBeNull();
    });

    it('resolveEdgeTarget_whenOutsideWorkspace_returnsNull', () => {
      expect(resolveEdgeTarget(-10, 400, workspace, 'tool')).toBeNull();
    });
  });

  describe('resolveEdgeGuideTarget', () => {
    it('resolveEdgeGuideTarget_whenOverTheLowerTopGuide_targetsTopWhereProximityDoesNot', () => {
      // The top guide square spans 14..54px from the top border, centred horizontally; a point 40px
      // down is past the 28px border threshold yet still on the guide.
      const x: number = workspace.left + workspace.width / 2;
      const y: number = 40;

      expect(resolveEdgeTarget(x, y, workspace, 'tool')).toBeNull();
      expect(resolveEdgeGuideTarget(x, y, workspace, 'tool')?.target).toEqual({
        kind: 'edge',
        side: 'top',
      });
    });

    it('resolveEdgeGuideTarget_whenDocument_returnsNull', () => {
      const x: number = workspace.left + workspace.width / 2;
      expect(resolveEdgeGuideTarget(x, 40, workspace, 'document')).toBeNull();
    });

    it('resolveEdgeGuideTarget_whenOverNoGuide_returnsNull', () => {
      expect(resolveEdgeGuideTarget(500, 400, workspace, 'tool')).toBeNull();
    });
  });

  describe('nearestEdge', () => {
    it('nearestEdge_whenRectHugsAnEdge_returnsThatEdge', () => {
      expect(nearestEdge({ left: 0, top: 300, width: 100, height: 100 }, workspace)).toBe('left');
      expect(nearestEdge({ left: 450, top: 0, width: 100, height: 100 }, workspace)).toBe('top');
      expect(nearestEdge({ left: 880, top: 300, width: 100, height: 100 }, workspace)).toBe(
        'right',
      );
    });
  });

  describe('resolveGroupTarget', () => {
    it('resolveGroupTarget_whenOverCentre_tabsIntoTheStack', () => {
      const resolution: DockResolution | null = resolveGroupTarget(
        200,
        200,
        'stack-1',
        'tool',
        group,
        'tool',
      );

      expect(resolution?.target).toEqual({ kind: 'tab', stackId: 'stack-1' });
      expect(resolution?.preview).toEqual(group);
    });

    it('resolveGroupTarget_whenOverAnEdge_splitsThatSide', () => {
      const resolution: DockResolution | null = resolveGroupTarget(
        110,
        200,
        'stack-1',
        'tool',
        group,
        'tool',
      );

      expect(resolution?.target).toEqual({ kind: 'split', stackId: 'stack-1', side: 'left' });
      expect(resolution?.preview.width).toBe(group.width / 2);
    });

    it('resolveGroupTarget_whenDocumentOverToolCentre_returnsNull', () => {
      expect(resolveGroupTarget(200, 200, 'stack-1', 'tool', group, 'document')).toBeNull();
    });

    it('resolveGroupTarget_whenToolOverDocumentCentre_returnsNull', () => {
      expect(resolveGroupTarget(200, 200, 'stack-1', 'document', group, 'tool')).toBeNull();
    });

    it('resolveGroupTarget_whenOutsideTheGroup_returnsNull', () => {
      expect(resolveGroupTarget(50, 50, 'stack-1', 'tool', group, 'tool')).toBeNull();
    });
  });

  describe('resolveCompassTarget', () => {
    // The group's centre, where the compass is drawn.
    const cx: number = group.left + group.width / 2;
    const cy: number = group.top + group.height / 2;

    it('resolveCompassTarget_whenOverCentreGuide_tabsIntoTheStack', () => {
      const resolution: DockResolution | null = resolveCompassTarget(
        cx,
        cy,
        cx,
        cy,
        'stack-1',
        'tool',
        group,
        'tool',
      );

      expect(resolution?.target).toEqual({ kind: 'tab', stackId: 'stack-1' });
    });

    it('resolveCompassTarget_whenOverTopGuide_splitsTop', () => {
      const resolution: DockResolution | null = resolveCompassTarget(
        cx,
        cy - 37,
        cx,
        cy,
        'stack-1',
        'tool',
        group,
        'tool',
      );

      expect(resolution?.target).toEqual({ kind: 'split', stackId: 'stack-1', side: 'top' });
    });

    it('resolveCompassTarget_whenOverTopGuideOfATallGroup_stillSplitsTop', () => {
      // On a tall group the top guide sits inside the position-based centre band, so the position
      // logic would tab in; the compass hit-test must still target the top split.
      const tall: Rect = { left: 100, top: 0, width: 200, height: 600 };
      const centerX: number = tall.left + tall.width / 2;
      const centerY: number = tall.top + tall.height / 2;

      expect(
        resolveGroupTarget(centerX, centerY - 37, 'stack-1', 'tool', tall, 'tool')?.target,
      ).toEqual({ kind: 'tab', stackId: 'stack-1' });
      expect(
        resolveCompassTarget(
          centerX,
          centerY - 37,
          centerX,
          centerY,
          'stack-1',
          'tool',
          tall,
          'tool',
        )?.target,
      ).toEqual({ kind: 'split', stackId: 'stack-1', side: 'top' });
    });

    it('resolveCompassTarget_whenOverNoGuide_returnsNull', () => {
      expect(
        resolveCompassTarget(group.left, group.top, cx, cy, 'stack-1', 'tool', group, 'tool'),
      ).toBeNull();
    });

    it('resolveCompassTarget_whenOverAnIllegalGuide_returnsNull', () => {
      // A tool dragged over a document well may not tab into its centre.
      expect(resolveCompassTarget(cx, cy, cx, cy, 'stack-1', 'document', group, 'tool')).toBeNull();
    });
  });
});
