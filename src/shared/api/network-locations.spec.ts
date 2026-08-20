import {
  isNetworkLocationAllowed,
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

    it('sanitize_whenNotAList_returnsEmpty', () => {
      expect(sanitizeNetworkLocations('api.example.com')).toEqual([]);
      expect(sanitizeNetworkLocations(undefined)).toEqual([]);
    });
  });

  describe('matchesNetworkLocation', () => {
    it('match_wildcardCoversSubdomainsAndTheBareDomain', () => {
      expect(matchesNetworkLocation('api.example.com', '*.example.com')).toBe(true);
      expect(matchesNetworkLocation('example.com', '*.example.com')).toBe(true);
      expect(matchesNetworkLocation('deep.api.example.com', '*.example.com')).toBe(true);
    });

    it('match_wildcardDoesNotCoverALookalikeDomain', () => {
      // The suffix test must not match `notexample.com`, which is the classic wildcard mistake.
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
