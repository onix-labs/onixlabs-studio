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
    commands.add('persona');

    expect(add).toHaveBeenCalledTimes(1);
    expect(importFrom).toHaveBeenCalledTimes(1);
    expect([...commands.registered()]).toEqual(['skills']);
  });

  it('unregister_clearsOnlyTheHandlerStillRegistered', () => {
    const first: AiLibraryCommandHandler = { add: vi.fn() };
    const secondAdd: Mock<() => void> = vi.fn<() => void>();
    const second: AiLibraryCommandHandler = { add: secondAdd };
    commands.register('persona', first);
    commands.register('persona', second);

    // A section destroyed after its replacement registered must not take the replacement with it.
    commands.unregister('persona', first);
    commands.add('persona');
    expect(secondAdd).toHaveBeenCalledTimes(1);

    commands.unregister('persona', second);
    expect(commands.registered().size).toBe(0);
  });

  it('importFrom_whenTheSectionCannotImport_doesNothing', () => {
    commands.register('persona', { add: vi.fn() });

    expect(() => commands.importFrom('persona')).not.toThrow();
  });
});
