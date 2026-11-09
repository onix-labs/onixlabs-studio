import { resolveDefaultEol } from './document-defaults';

describe('resolveDefaultEol', () => {
  it('takesLfOrCrlfAsChosen', () => {
    expect(resolveDefaultEol('lf', 'win32')).toBe('LF');
    expect(resolveDefaultEol('crlf', 'darwin')).toBe('CRLF');
  });

  it('system_isCrlfOnWindows_andLfElsewhere', () => {
    expect(resolveDefaultEol('system', 'win32')).toBe('CRLF');
    expect(resolveDefaultEol('system', 'darwin')).toBe('LF');
    expect(resolveDefaultEol('system', 'linux')).toBe('LF');
    expect(resolveDefaultEol('system', undefined)).toBe('LF');
  });
});
