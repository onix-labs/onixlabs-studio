import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installCommand } from './commands';
import type { PackageCommand } from './protocol';

describe('installCommand', () => {
  it('installCommand_eitherConanfile_isConanInstallInItsFolder', () => {
    // Arrange
    const projects: readonly string[] = [
      path.resolve('/work/app/conanfile.txt'),
      path.resolve('/work/lib/conanfile.py'),
    ];

    // Act
    const commands: readonly PackageCommand[] = projects.map(installCommand);

    // Assert
    expect(commands).toEqual([
      {
        executable: 'conan',
        args: ['install', '.'],
        cwd: path.resolve('/work/app'),
        title: 'Install Conan dependencies',
      },
      {
        executable: 'conan',
        args: ['install', '.'],
        cwd: path.resolve('/work/lib'),
        title: 'Install Conan dependencies',
      },
    ]);
  });

  it('installCommand_notAConanfile_isRefused', () => {
    // Arrange
    const project: string = path.resolve('/work/app/CMakeLists.txt');

    // Act
    const attempt: () => PackageCommand = (): PackageCommand => installCommand(project);

    // Assert
    expect(attempt).toThrow(/conanfile/);
  });

  it('installCommand_aRelativePath_isRefused', () => {
    // Arrange
    const project: string = 'conanfile.txt';

    // Act
    const attempt: () => PackageCommand = (): PackageCommand => installCommand(project);

    // Assert
    expect(attempt).toThrow(/conanfile/);
  });
});
