import { coarseGrantSource, sanitizeToolPolicies } from './tool-policy';

describe('tool-policy', () => {
  describe('coarseGrantSource', () => {
    it('coarseGrantSource_whenPolicyAllows_isPolicy', () => {
      // An explicit allow wins even under an auto-allowing posture.
      expect(coarseGrantSource('allow', 'auto-all', false)).toBe('policy');
    });

    it('coarseGrantSource_whenPostureAutoAllsOrAutoEditsAnEditTool_isPosture', () => {
      expect(coarseGrantSource('ask', 'auto-all', false)).toBe('posture');
      expect(coarseGrantSource('ask', 'auto-edits', true)).toBe('posture');
    });

    it('coarseGrantSource_whenAutoEditsButNotAnEditTool_isGatedOrAuto', () => {
      // `auto-edits` only auto-allows edit tools; a shell command still runs via the ordinary path.
      expect(coarseGrantSource('ask', 'auto-edits', false)).toBe('gated-or-auto');
    });

    it('coarseGrantSource_whenAskAndPrompt_isGatedOrAuto', () => {
      expect(coarseGrantSource('ask', 'prompt', true)).toBe('gated-or-auto');
      expect(coarseGrantSource('ask', 'prompt', false)).toBe('gated-or-auto');
    });
  });

  describe('sanitizeToolPolicies', () => {
    it('sanitizeToolPolicies_keepsValidAllowAndDenyEntries', () => {
      expect(sanitizeToolPolicies({ Write: 'deny', Bash: 'allow' })).toEqual({
        Write: 'deny',
        Bash: 'allow',
      });
    });

    it('sanitizeToolPolicies_dropsAskAsTheDefault', () => {
      // `ask` is the default, so it never needs to be stored — the map stays sparse.
      expect(sanitizeToolPolicies({ Write: 'ask', Bash: 'deny' })).toEqual({ Bash: 'deny' });
    });

    it('sanitizeToolPolicies_dropsUnknownValuesAndEmptyKeys', () => {
      expect(
        sanitizeToolPolicies({ Write: 'nonsense', Edit: 42, '': 'deny', Bash: 'allow' }),
      ).toEqual({ Bash: 'allow' });
    });

    it('sanitizeToolPolicies_whenNotAnObject_returnsEmpty', () => {
      expect(sanitizeToolPolicies(null)).toEqual({});
      expect(sanitizeToolPolicies('deny')).toEqual({});
      expect(sanitizeToolPolicies(undefined)).toEqual({});
      expect(sanitizeToolPolicies(7)).toEqual({});
    });
  });
});
