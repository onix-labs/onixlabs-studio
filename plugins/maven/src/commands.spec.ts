import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gradleRestoreCommand, mavenRestoreCommand } from './commands';

describe('mavenRestoreCommand', () => {
  it('mavenRestoreCommand_noWrapper_runsMavenOnThePom', () => {
    const pom: string = path.join(path.sep, 'work', 'api', 'pom.xml');

    expect(mavenRestoreCommand(pom, null)).toEqual({
      executable: 'mvn',
      args: ['-f', 'pom.xml', 'dependency:resolve'],
      cwd: path.dirname(pom),
      title: 'Resolve dependencies',
    });
  });

  it('mavenRestoreCommand_aWrapper_runsTheWrapper', () => {
    const wrapper: string = path.join(path.sep, 'work', 'mvnw');

    expect(mavenRestoreCommand(path.join(path.sep, 'work', 'pom.xml'), wrapper).executable).toBe(
      wrapper,
    );
  });
});

describe('gradleRestoreCommand', () => {
  it('gradleRestoreCommand_theRootProject_runsItsDependenciesTask', () => {
    expect(gradleRestoreCommand('/work', ':', null)).toEqual({
      executable: 'gradle',
      args: [':dependencies'],
      cwd: '/work',
      title: 'Resolve dependencies',
    });
  });

  it('gradleRestoreCommand_aSubproject_runsItsTaskThroughTheWrapper', () => {
    expect(gradleRestoreCommand('/work', ':lib:core', '/work/gradlew')).toMatchObject({
      executable: '/work/gradlew',
      args: [':lib:core:dependencies'],
    });
  });

  it('gradleRestoreCommand_aPathThatCouldBeAnOption_isRefused', () => {
    expect(() => gradleRestoreCommand('/work', '--init-script=x', null)).toThrow(
      'is not a Gradle project path',
    );
    expect(() => gradleRestoreCommand('/work', ':-x', null)).toThrow();
    expect(() => gradleRestoreCommand('/work', ':a b', null)).toThrow();
  });
});
