import { describe, expect, it } from 'vitest';
import { redactSecrets, stripUrlCredentials } from './redaction';

describe('stripUrlCredentials', () => {
  it('removesTheCredentials_andLeavesTheRest', () => {
    expect(stripUrlCredentials('https://user:ghp_abc123@github.com/org/repo.git')).toBe(
      'https://github.com/org/repo.git',
    );
    expect(stripUrlCredentials('https://x-access-token:tok@github.com/a/b')).toBe(
      'https://github.com/a/b',
    );
    expect(stripUrlCredentials('https://github.com/org/repo.git')).toBe(
      'https://github.com/org/repo.git',
    );
    // An SSH shorthand carries a user, not a credential.
    expect(stripUrlCredentials('git@github.com:org/repo.git')).toBe('git@github.com:org/repo.git');
    expect(stripUrlCredentials('not a url')).toBe('not a url');
  });
});

describe('redactSecrets', () => {
  it('masksCredentialsInAUrl_whereverItAppears', () => {
    expect(
      redactSecrets(
        'Command failed: git clone -- https://me:ghp_s3cret12345678901234@host/r /dest',
      ),
    ).toBe('Command failed: git clone -- https://[redacted]@host/r /dest');
  });

  it('masksTokensByTheirShape', () => {
    for (const secret of [
      'ghp_abcdefghijklmnopqrstuvwxyz0123',
      'github_pat_11ABCDEFG0_abcdefghijklmnopqrstuvwxyz',
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
      'sk-proj-abcdefghijklmnopqrstu',
      'xoxb-1234567890-abcdefghij',
      'AKIAIOSFODNN7EXAMPLE',
      'AIzaSyA-abcdefghijklmnopqrstuvwxyz0123456',
    ]) {
      const masked: string = redactSecrets(`token was ${secret} today`);
      expect(masked).not.toContain(secret);
      expect(masked).toContain('[redacted]');
    }
  });

  it('masksAValueLabelledAsASecret_andKeepsTheLabel', () => {
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnop.qrstuv')).toBe(
      'Authorization: Bearer [redacted]',
    );
    expect(redactSecrets('api_key=0123456789abcdef&page=2')).toBe('api_key=[redacted]&page=2');
    expect(redactSecrets('{"password": "hunter2hunter2"}')).toBe('{"password": "[redacted]"}');
    expect(redactSecrets('NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz')).toBe('NPM_TOKEN=[redacted]');
  });

  it('masksAPrivateKeyBlock', () => {
    const key: string = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----';
    expect(redactSecrets(`found ${key} in the folder`)).toBe('found [redacted] in the folder');
  });

  it('leavesOrdinaryTextAlone', () => {
    const text: string =
      'Opened repository /Users/me/project (open count 1); token count 1200; the password field';
    expect(redactSecrets(text)).toBe(text);
    expect(redactSecrets('Cloning https://github.com/org/repo.git into /tmp/x')).toBe(
      'Cloning https://github.com/org/repo.git into /tmp/x',
    );
  });
});
