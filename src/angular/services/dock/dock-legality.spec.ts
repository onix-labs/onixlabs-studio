import {
  DockResolution,
  guideLegality,
  Rect,
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
});
