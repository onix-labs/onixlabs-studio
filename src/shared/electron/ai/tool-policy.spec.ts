import { sanitizeToolPolicies } from './tool-policy';

describe('tool-policy', () => {
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
