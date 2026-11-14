import { describe, expect, it } from 'vitest';
import { iconTarget } from './process-icons';

describe('iconTarget', () => {
  it('takesTheOutermostAppBundle_onMacOS', () => {
    expect(
      iconTarget(
        '/Applications/ONIXLabs Studio.app/Contents/Frameworks/Studio Helper (Renderer).app/Contents/MacOS',
        'Studio Helper (Renderer)',
        'darwin',
      ),
    ).toBe('/Applications/ONIXLabs Studio.app');
  });

  it('findsNoIcon_forAProcessOutsideAnAppBundle', () => {
    expect(iconTarget('/usr/sbin', 'cfprefsd', 'darwin')).toBeNull();
    expect(iconTarget('', 'kernel_task', 'darwin')).toBeNull();
  });

  it('takesTheExecutable_onWindows', () => {
    expect(iconTarget('C:\\Program Files\\App', 'app.exe', 'win32')).toBe(
      'C:\\Program Files\\App\\app.exe',
    );
    expect(iconTarget('C:\\Windows\\explorer.exe', 'explorer.exe', 'win32')).toBe(
      'C:\\Windows\\explorer.exe',
    );
    expect(iconTarget('C:\\Windows', 'System', 'win32')).toBeNull();
  });

  it('findsNoIcon_onLinux', () => {
    expect(iconTarget('/usr/bin', 'node', 'linux')).toBeNull();
  });
});
