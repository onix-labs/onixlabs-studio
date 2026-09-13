import { afterEach, describe, expect, it } from 'vitest';
import { pythonRuntime, setPythonRuntimeForTesting } from './python-runtime';

describe('pythonRuntime', (): void => {
  afterEach((): void => {
    setPythonRuntimeForTesting(null);
  });

  it('runsTheEntryPointAsAScriptUnderTheInterpreter', (): void => {
    setPythonRuntimeForTesting('/usr/bin/python3');

    // A script, not `-m`: the entry point arranges its own imports, so Studio never has to know the
    // package layout inside a payload it merely extracted.
    expect(pythonRuntime('/payload/debugpy/adapter/__main__.py')).toEqual({
      command: '/usr/bin/python3',
      args: ['/payload/debugpy/adapter/__main__.py'],
    });
  });

  it('answersNullWhenTheMachineHasNoInterpreter', (): void => {
    setPythonRuntimeForTesting(null);

    expect(pythonRuntime('/payload/main.py')).toBeNull();
  });

  it('answersNullBeforeTheSearchHasRun', (): void => {
    // Undefined rather than null: nobody has looked yet. It answers the same as "none found", because
    // a caller that cannot run anything does not care which of the two is true — and start-up kicks
    // the search off long before a plugin is spawned.
    setPythonRuntimeForTesting(undefined as unknown as string | null);

    expect(pythonRuntime('/payload/main.py')).toBeNull();
  });
});
