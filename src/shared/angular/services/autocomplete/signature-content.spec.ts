import type * as MonacoApi from 'monaco-editor';
import {
  parameterSpan,
  SignatureRun,
  SignatureView,
  signatureRuns,
  signatureView,
} from './signature-content';

/**
 * Builds a signature.
 * @param label The label.
 * @param parameters The parameters' labels.
 * @returns Returns the signature.
 */
function signature(
  label: string,
  parameters: readonly (string | [number, number])[],
): MonacoApi.languages.SignatureInformation {
  return {
    label,
    parameters: parameters.map(
      (parameter: string | [number, number]): MonacoApi.languages.ParameterInformation => ({
        label: parameter,
      }),
    ),
  };
}

describe('signature content (#1021)', () => {
  it('highlightsTheActiveParameter_byItsText', () => {
    const view: SignatureView | null = signatureView({
      signatures: [signature('add(a: number, b: number): number', ['a: number', 'b: number'])],
      activeSignature: 0,
      activeParameter: 1,
    });

    expect(view?.runs).toEqual([
      { text: 'add(a: number, ', active: false },
      { text: 'b: number', active: true },
      { text: '): number', active: false },
    ]);
    expect(view?.overload).toBeNull();
  });

  it('highlightsTheActiveParameter_byItsOffsets', () => {
    expect(
      parameterSpan(
        signature('f(x, y)', [
          [2, 3],
          [5, 6],
        ]),
        { label: [5, 6] },
      ),
    ).toEqual([5, 6]);
  });

  it('findsAParameterNamedLikeItsFunction_amongTheParameters', () => {
    expect(parameterSpan(signature('value(value)', ['value']), { label: 'value' })).toEqual([
      6, 11,
    ]);
  });

  it('findsAParameter_onlyAsAWholeWord', () => {
    expect(parameterSpan(signature('f(ab, b)', ['ab', 'b']), { label: 'b' })).toEqual([6, 7]);
    expect(parameterSpan(signature('f(a)', ['z']), { label: 'z' })).toBeNull();
  });

  it('takesTheSignaturesOwnActiveParameter_overTheAnswers', () => {
    const view: SignatureView | null = signatureView({
      signatures: [{ ...signature('f(a, b)', ['a', 'b']), activeParameter: 0 }],
      activeSignature: 0,
      activeParameter: 1,
    });

    expect(view?.runs.find((run: SignatureRun): boolean => run.active)?.text).toBe('a');
  });

  it('saysWhichOverloadShows_andClampsAnActiveSignatureOutOfRange', () => {
    const view: SignatureView | null = signatureView({
      signatures: [
        signature('f()', []),
        signature('f(a)', ['a']),
        signature('f(a, b)', ['a', 'b']),
      ],
      activeSignature: 7,
      activeParameter: 0,
    });

    expect(view?.overload).toEqual({ index: 2, count: 3 });
    expect(view?.runs[0].text.startsWith('f(')).toBe(true);
  });

  it('showsTheParametersDocumentation_thenTheSignatures', () => {
    const view: SignatureView | null = signatureView({
      signatures: [
        {
          label: 'f(a)',
          documentation: { value: 'Does **f**.' },
          parameters: [{ label: 'a', documentation: 'The a.' }],
        },
      ],
      activeSignature: 0,
      activeParameter: 0,
    });

    expect(view?.sections).toEqual(['The a\\.', 'Does **f**.']);
  });

  it('hasNothing_forAnAnswerWithNoSignatures', () => {
    expect(signatureView({ signatures: [], activeSignature: 0, activeParameter: 0 })).toBeNull();
  });

  it('signatureRuns_withNoParameter_isTheWholeLabel', () => {
    expect(signatureRuns('f()', null)).toEqual([{ text: 'f()', active: false }]);
  });
});
