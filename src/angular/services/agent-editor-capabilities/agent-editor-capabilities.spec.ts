import { TestBed } from '@angular/core/testing';

import { READ_ACTIVE_DOCUMENT, REPLACE_ACTIVE_DOCUMENT } from '../../../shared/ai-types';
import { AiCapability, AiRuntime } from '../ai-runtime/ai-runtime';
import { CodeCommandHandler, CodeCommands } from '../code-commands/code-commands';
import { AgentEditorCapabilities } from './agent-editor-capabilities';

/**
 * Builds a code command handler whose text is backed by a mutable string and whose ribbon commands
 * are no-ops.
 * @param initial The initial text.
 * @returns Returns the handler.
 */
function textHandler(initial: string): CodeCommandHandler {
  let text: string = initial;
  return {
    cut: (): void => undefined,
    copy: (): void => undefined,
    paste: (): void => undefined,
    undo: (): void => undefined,
    redo: (): void => undefined,
    find: (): void => undefined,
    formatDocument: (): void => undefined,
    save: (): void => undefined,
    saveAs: (): void => undefined,
    getText: (): string => text,
    replaceText: (value: string): void => {
      text = value;
    },
  };
}

describe('AgentEditorCapabilities', () => {
  let registered: Map<string, AiCapability>;
  let codeCommands: CodeCommands;

  beforeEach(() => {
    registered = new Map<string, AiCapability>();
    const runtimeStub: Pick<AiRuntime, 'registerCapability'> = {
      registerCapability: (name: string, handler: AiCapability): (() => void) => {
        registered.set(name, handler);
        return (): void => undefined;
      },
    };
    TestBed.configureTestingModule({
      providers: [{ provide: AiRuntime, useValue: runtimeStub }],
    });
    codeCommands = TestBed.inject(CodeCommands);
    // Instantiate the service so it registers its capabilities.
    TestBed.inject(AgentEditorCapabilities);
  });

  it('constructor_whenInstantiated_registersReadAndReplaceCapabilities', () => {
    expect(registered.has(READ_ACTIVE_DOCUMENT)).toBe(true);
    expect(registered.has(REPLACE_ACTIVE_DOCUMENT)).toBe(true);
  });

  it('read_whenNoEditorActive_reportsUnavailable', () => {
    const read: AiCapability | undefined = registered.get(READ_ACTIVE_DOCUMENT);

    expect(read?.(undefined)).toEqual({ available: false, text: '' });
  });

  it('read_whenEditorActive_returnsItsText', () => {
    codeCommands.register(textHandler('hello'));
    const read: AiCapability | undefined = registered.get(READ_ACTIVE_DOCUMENT);

    expect(read?.(undefined)).toEqual({ available: true, text: 'hello' });
  });

  it('replace_whenEditorActive_updatesTheDocumentAndReportsOk', () => {
    codeCommands.register(textHandler('old'));
    const replace: AiCapability | undefined = registered.get(REPLACE_ACTIVE_DOCUMENT);

    expect(replace?.({ text: 'new' })).toEqual({ ok: true });
    expect(codeCommands.readActiveText()).toBe('new');
  });

  it('replace_whenInputMalformed_reportsNotOk', () => {
    codeCommands.register(textHandler('x'));
    const replace: AiCapability | undefined = registered.get(REPLACE_ACTIVE_DOCUMENT);

    expect(replace?.({})).toEqual({ ok: false });
  });
});
