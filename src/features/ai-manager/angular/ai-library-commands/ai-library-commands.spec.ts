import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, Mock, vi } from 'vitest';
import { AiLibraryCommandHandler, AiLibraryCommands } from './ai-library-commands';

describe('AiLibraryCommands', () => {
  let commands: AiLibraryCommands;

  beforeEach(() => {
    commands = TestBed.inject(AiLibraryCommands);
  });

  it('forwardsToTheRegisteredSectionOnly', () => {
    const add: Mock<() => void> = vi.fn<() => void>();
    const importFrom: Mock<() => void> = vi.fn<() => void>();
    commands.register('skills', { add, importFrom });

    commands.add('skills');
    commands.importFrom('skills');
    commands.add('profiles');

    expect(add).toHaveBeenCalledTimes(1);
    expect(importFrom).toHaveBeenCalledTimes(1);
    expect([...commands.registered()]).toEqual(['skills']);
  });

  it('unregister_clearsOnlyTheHandlerStillRegistered', () => {
    const first: AiLibraryCommandHandler = { add: vi.fn() };
    const secondAdd: Mock<() => void> = vi.fn<() => void>();
    const second: AiLibraryCommandHandler = { add: secondAdd };
    commands.register('profiles', first);
    commands.register('profiles', second);

    // A section destroyed after its replacement registered must not take the replacement with it.
    commands.unregister('profiles', first);
    commands.add('profiles');
    expect(secondAdd).toHaveBeenCalledTimes(1);

    commands.unregister('profiles', second);
    expect(commands.registered().size).toBe(0);
  });

  it('importFrom_whenTheSectionCannotImport_doesNothing', () => {
    commands.register('profiles', { add: vi.fn() });

    expect(() => commands.importFrom('profiles')).not.toThrow();
  });
});
