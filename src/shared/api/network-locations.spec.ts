import {
  expandNetworkLocations,
  isNetworkLocationAllowed,
  isValidNetworkLocation,
  matchesNetworkLocation,
  normaliseNetworkLocation,
  sanitizeNetworkLocations,
} from './network-locations';

describe('network-locations', () => {
  describe('normaliseNetworkLocation', () => {
    it('normalise_reducesWhateverTheUserTypedToAHost', () => {
      // One list, however it is typed: a pasted URL, a host with a port, or a bare host.
      expect(normaliseNetworkLocation('https://api.example.com/v1/orders?x=1')).toBe(
        'api.example.com',
      );
      expect(normaliseNetworkLocation('api.example.com:8443')).toBe('api.example.com');
      expect(normaliseNetworkLocation('  API.Example.COM  ')).toBe('api.example.com');
      expect(normaliseNetworkLocation('user:pass@api.example.com')).toBe('api.example.com');
    });

    it('normalise_keepsAWildcardPatternAsWritten', () => {
      expect(normaliseNetworkLocation('*.example.com')).toBe('*.example.com');
      expect(normaliseNetworkLocation('https://*.example.com/')).toBe('*.example.com');
    });

    it('normalise_unwrapsAnIpv6Literal', () => {
      expect(normaliseNetworkLocation('http://[::1]:9000/health')).toBe('::1');
    });

    it('normalise_whenNothingUsableRemains_returnsEmpty', () => {
      expect(normaliseNetworkLocation('   ')).toBe('');
      expect(normaliseNetworkLocation('https://')).toBe('');
    });
  });

  describe('sanitizeNetworkLocations', () => {
    it('sanitize_dropsBlanksAndDuplicatesAndNonStrings', () => {
      expect(
        sanitizeNetworkLocations([
          'https://api.example.com',
          'api.example.com',
          '  ',
          42,
          null,
          '*.corp.test',
        ]),
      ).toEqual(['api.example.com', '*.corp.test']);
    });

    it('sanitize_dropsPatternsTheSandboxWouldRefuse', () => {
      expect(sanitizeNetworkLocations(['*', '*.com', 'api.example.com'])).toEqual([
        'api.example.com',
      ]);
    });

    it('sanitize_whenNotAList_returnsEmpty', () => {
      expect(sanitizeNetworkLocations('api.example.com')).toEqual([]);
      expect(sanitizeNetworkLocations(undefined)).toEqual([]);
    });
  });

  describe('isValidNetworkLocation', () => {
    it('valid_acceptsAHostOrALeftmostWildcard', () => {
      expect(isValidNetworkLocation('api.example.com')).toBe(true);
      expect(isValidNetworkLocation('*.example.com')).toBe(true);
      expect(isValidNetworkLocation('api-*.example.com')).toBe(true);
    });

    it('valid_rejectsThePatternsTheSandboxRefuses', () => {
      // Saving one of these would store a rule the sandbox then throws out — a boundary that silently
      // is not one.
      expect(isValidNetworkLocation('*')).toBe(false);
      expect(isValidNetworkLocation('*.com')).toBe(false);
      expect(isValidNetworkLocation('*.*.example.com')).toBe(false);
      expect(isValidNetworkLocation('api.*.example.com')).toBe(false);
      expect(isValidNetworkLocation('api..example.com')).toBe(false);
    });
  });

  describe('expandNetworkLocations', () => {
    it('expand_addsTheApexAWildcardIsTakenToInclude', () => {
      expect(expandNetworkLocations(['*.example.com'])).toEqual(['*.example.com', 'example.com']);
    });

    it('expand_leavesAPlainHostAlone_andDeduplicates', () => {
      expect(expandNetworkLocations(['example.com', '*.example.com'])).toEqual([
        'example.com',
        '*.example.com',
      ]);
    });
  });

  describe('matchesNetworkLocation', () => {
    it('match_wildcardCoversOneLabel_asTheSandboxDoes', () => {
      expect(matchesNetworkLocation('api.example.com', '*.example.com')).toBe(true);
      expect(matchesNetworkLocation('api-eu.example.com', 'api-*.example.com')).toBe(true);
    });

    it('match_wildcardDoesNotSpanLabels', () => {
      // The sandbox matches label-for-label; a suffix test here would allow what the shell blocks.
      expect(matchesNetworkLocation('deep.api.example.com', '*.example.com')).toBe(false);
      expect(matchesNetworkLocation('example.com', '*.example.com')).toBe(false);
    });

    it('match_wildcardDoesNotCoverALookalikeDomain', () => {
      expect(matchesNetworkLocation('notexample.com', '*.example.com')).toBe(false);
      expect(matchesNetworkLocation('example.com.evil.test', '*.example.com')).toBe(false);
    });

    it('match_exactPatternMatchesOnlyThatHost', () => {
      expect(matchesNetworkLocation('api.example.com', 'api.example.com')).toBe(true);
      expect(matchesNetworkLocation('other.example.com', 'api.example.com')).toBe(false);
    });
  });

  describe('isNetworkLocationAllowed', () => {
    it('allowed_whenNoListIsConfigured_permitsAnything', () => {
      // Empty means "as Studio has always behaved", so the setting is opt-in.
      expect(isNetworkLocationAllowed('https://anywhere.test/x', [], [])).toBe(true);
    });

    it('allowed_whenAListIsConfigured_permitsOnlyWhatItNames', () => {
      const allowed: readonly string[] = ['*.corp.test'];
      expect(isNetworkLocationAllowed('https://api.corp.test/orders', allowed, [])).toBe(true);
      expect(isNetworkLocationAllowed('https://pastebin.test/upload', allowed, [])).toBe(false);
    });

    it('allowed_aWildcardIncludesTheApex_matchingWhatTheSandboxIsHanded', () => {
      // The one convenience over the sandbox's own rule, and it is expanded on the way out so both
      // enforcement points agree.
      expect(isNetworkLocationAllowed('https://corp.test/', ['*.corp.test'], [])).toBe(true);
    });

    it('allowed_aWildcardDoesNotReachADeeperSubdomain', () => {
      // The sandbox cannot express this, so neither does the check: one list, one meaning.
      expect(isNetworkLocationAllowed('https://a.b.corp.test/', ['*.corp.test'], [])).toBe(false);
    });

    it('allowed_github_needsTheHostTheToolActuallyTalksTo', () => {
      // The case that started this: `github.com` does not cover `api.github.com` in either matcher.
      expect(isNetworkLocationAllowed('https://api.github.com/repos', ['github.com'], [])).toBe(
        false,
      );
      expect(isNetworkLocationAllowed('https://api.github.com/repos', ['*.github.com'], [])).toBe(
        true,
      );
      expect(isNetworkLocationAllowed('https://github.com/x', ['*.github.com'], [])).toBe(true);
    });

    it('allowed_deniedWinsOverAllowed', () => {
      expect(
        isNetworkLocationAllowed('https://admin.corp.test/', ['*.corp.test'], ['admin.corp.test']),
      ).toBe(false);
    });

    it('allowed_refusesTheCloudMetadataAddressWhateverIsConfigured', () => {
      // The sharpest edge: unauthenticated role credentials, one request away.
      expect(isNetworkLocationAllowed('http://169.254.169.254/latest/meta-data/', [], [])).toBe(
        false,
      );
      expect(isNetworkLocationAllowed('http://169.254.169.254/', ['169.254.169.254'], [])).toBe(
        false,
      );
      expect(isNetworkLocationAllowed('http://metadata.google.internal/', [], [])).toBe(false);
    });

    it('allowed_permitsLoopback_becauseThatIsWhatTheViewIsFor', () => {
      expect(isNetworkLocationAllowed('http://localhost:8080/health', [], [])).toBe(true);
    });

    it('allowed_whenTheUrlCannotBeParsed_refuses', () => {
      // An engine that cannot tell where a request is going cannot claim it is allowed.
      expect(isNetworkLocationAllowed('not a url', [], [])).toBe(false);
    });
  });
});
