import type * as MonacoApi from 'monaco-editor';
import type { ParameterHintsControl } from '@shared/angular/services/monaco/monaco-suggest-commands';
import type { SignatureRun, SignatureView } from './signature-content';
import { SignatureSession, SignatureSurface } from './signature-session';
import type { EditorOrigin } from './suggest-session';

/**
 * Builds a signature-help answer.
 * @param count How many overloads it has.
 * @returns Returns the answer.
 */
function hints(count: number): MonacoApi.languages.SignatureHelp {
  return {
    signatures: Array.from({ length: count }, (_: unknown, index: number) => ({
      label: `f${index}(a)`,
      parameters: [{ label: 'a' }],
    })),
    activeSignature: 0,
    activeParameter: 0,
  };
}

describe('SignatureSession (#1021)', () => {
  let keys: Map<string, boolean>;
  let listeners: Map<string, (() => void)[]>;
  let frames: (() => void)[];
  let views: SignatureView[];
  let origins: (EditorOrigin | null)[];
  let disposed: number;
  let presentedWith: ParameterHintsControl | null;
  let visible: boolean;
  let session: SignatureSession;
  const control: ParameterHintsControl = {
    next: (): void => undefined,
    previous: (): void => undefined,
    cancel: (): void => undefined,
  };

  beforeEach(() => {
    keys = new Map<string, boolean>();
    listeners = new Map<string, (() => void)[]>();
    frames = [];
    views = [];
    origins = [];
    disposed = 0;
    presentedWith = null;
    visible = true;
    const subscribe: (event: string) => (listener: () => void) => MonacoApi.IDisposable =
      (event: string) =>
      (listener: () => void): MonacoApi.IDisposable => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return { dispose: (): void => undefined };
      };
    const editor: MonacoApi.editor.ICodeEditor = {
      createContextKey: (key: string, value: boolean) => {
        keys.set(key, value);
        return { set: (next: boolean): void => void keys.set(key, next) };
      },
      onDidChangeCursorPosition: subscribe('cursor'),
      onDidScrollChange: subscribe('scroll'),
      onDidLayoutChange: subscribe('layout'),
      getPosition: () => ({ lineNumber: 3, column: 9 }),
      getScrolledVisiblePosition: () => (visible ? { top: 40, left: 60, height: 18 } : null),
      getContainerDomNode: () => ({
        getBoundingClientRect: () => ({ left: 5, top: 10, width: 600, height: 300 }),
      }),
    } as unknown as MonacoApi.editor.ICodeEditor;
    session = new SignatureSession(editor, {
      present: (_origin: EditorOrigin, given: ParameterHintsControl): SignatureSurface => {
        presentedWith = given;
        return {
          update: (view: SignatureView): void => void views.push(view),
          place: (origin: EditorOrigin | null): void => void origins.push(origin),
          dispose: (): void => void (disposed += 1),
        };
      },
      frame: (run: () => void): (() => void) => {
        frames.push(run);
        return (): void => {
          frames = frames.filter((frame: () => void): boolean => frame !== run);
        };
      },
    });
  });

  /**
   * Runs the pending frames.
   */
  function flush(): void {
    const pending: (() => void)[] = frames;
    frames = [];
    for (const frame of pending) {
      frame();
    }
  }

  it('showsTheCard_aboveTheCaret_withItsKeys', () => {
    session.show(control, hints(1));
    flush();

    expect(keys.get('studioParameterHintsVisible')).toBe(true);
    expect(keys.get('studioParameterHintsMultiple')).toBe(false);
    expect(views[0].runs.find((run: SignatureRun): boolean => run.active)?.text).toBe('a');
    expect(origins[0]).toEqual({ x: 65, y: 50, width: 0, height: 18 });
    expect(presentedWith).toBe(control);
  });

  it('saysWhenThereAreOverloads', () => {
    session.show(control, hints(3));

    expect(keys.get('studioParameterHintsMultiple')).toBe(true);
  });

  it('followsTheCaret_onceAFrame', () => {
    session.show(control, hints(1));
    flush();

    listeners.get('cursor')?.forEach((listener: () => void): void => listener());
    listeners.get('scroll')?.forEach((listener: () => void): void => listener());
    expect(frames).toHaveLength(1);
    flush();

    expect(origins).toHaveLength(2);
  });

  it('hide_takesTheCardAway_andClearsItsKeys', () => {
    session.show(control, hints(2));
    flush();

    session.hide();

    expect(disposed).toBe(1);
    expect(session.showing).toBe(false);
    expect(keys.get('studioParameterHintsVisible')).toBe(false);
    expect(keys.get('studioParameterHintsMultiple')).toBe(false);
  });

  it('anAnswerWithNoSignatures_hidesTheCard', () => {
    session.show(control, hints(1));
    session.show(control, hints(0));

    expect(session.showing).toBe(false);
  });

  it('waitsToDraw_untilTheCaretCanBeSeen', () => {
    visible = false;
    session.show(control, hints(1));
    flush();

    expect(presentedWith).toBeNull();
  });
});
