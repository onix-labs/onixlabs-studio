import { describe, expect, it } from 'vitest';
import { describeError, splitQualifiedName } from './engine';

describe('splitQualifiedName', (): void => {
  it('splitsABareName_intoOnePart', (): void => {
    expect(splitQualifiedName('orders')).toEqual(['orders']);
  });

  it('splitsAQualifiedName_outermostFirst', (): void => {
    expect(splitQualifiedName('shop.public.orders')).toEqual(['shop', 'public', 'orders']);
  });

  it('unquotesDoubleQuotedParts_keepingDotsAndSpacesInside', (): void => {
    expect(splitQualifiedName('"My Schema"."Order.Lines"')).toEqual(['My Schema', 'Order.Lines']);
  });

  it('unquotesBacktickedAndBracketedParts', (): void => {
    expect(splitQualifiedName('`orders`')).toEqual(['orders']);
    expect(splitQualifiedName('[dbo].[order lines]')).toEqual(['dbo', 'order lines']);
  });

  it('undoublesAnEmbeddedQuote', (): void => {
    expect(splitQualifiedName('"say ""hi"""')).toEqual(['say "hi"']);
    expect(splitQualifiedName('`a``b`')).toEqual(['a`b']);
  });

  it('dropsWhitespaceOutsideQuotes_andEmptyParts', (): void => {
    expect(splitQualifiedName(' public . orders ')).toEqual(['public', 'orders']);
    expect(splitQualifiedName('public.')).toEqual(['public']);
    expect(splitQualifiedName('')).toEqual([]);
  });

  it('mixesQuotedAndBareParts', (): void => {
    expect(splitQualifiedName('public."Order"')).toEqual(['public', 'Order']);
  });
});

/**
 * Builds an error with a system code, as Node's network errors carry.
 * @param message The message.
 * @param code The code.
 * @returns Returns the error.
 */
function coded(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('describeError', (): void => {
  it('givesAnErrorsMessage', (): void => {
    expect(describeError(new Error('relation "orders" does not exist'))).toBe(
      'relation "orders" does not exist',
    );
  });

  it('withNoMessage_givesTheErrorsCode', (): void => {
    expect(describeError(coded('', 'ECONNREFUSED'))).toBe('ECONNREFUSED');
  });

  it('withNoMessageOrCode_givesTheErrorsName', (): void => {
    expect(describeError(new TypeError(''))).toBe('TypeError');
    expect(describeError(Object.assign(new Error(''), { code: 42 }))).toBe('Error');
  });

  it('givesAnythingElseAsText', (): void => {
    expect(describeError('plain words')).toBe('plain words');
    expect(describeError(42)).toBe('42');
    expect(describeError(null)).toBe('null');
  });

  it('anAggregate_givesItsInnerReasons_joined', (): void => {
    // As Node reports a refused `localhost`: one error per address it tried, under an empty message.
    const error: AggregateError = new AggregateError(
      [
        coded('connect ECONNREFUSED ::1:5432', 'ECONNREFUSED'),
        coded('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED'),
      ],
      '',
    );

    expect(describeError(error)).toBe(
      'connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432',
    );
  });

  it('anAggregate_givesEachReasonOnce', (): void => {
    const error: AggregateError = new AggregateError(
      [coded('', 'ECONNREFUSED'), coded('', 'ECONNREFUSED'), new Error('timed out')],
      '',
    );

    expect(describeError(error)).toBe('ECONNREFUSED; timed out');
  });

  it('anAggregate_ofNestedAggregates_givesTheInnermostReasons', (): void => {
    const error: AggregateError = new AggregateError(
      [new AggregateError([new Error('deep')], ''), 'shallow'],
      '',
    );

    expect(describeError(error)).toBe('deep; shallow');
  });

  it('anAggregate_withNoInnerReasons_fallsBackToItsOwnMessage', (): void => {
    expect(describeError(new AggregateError([], 'all attempts failed'))).toBe(
      'all attempts failed',
    );
  });

  it('anAggregate_withNothingToSayAtAll_givesItsName', (): void => {
    expect(describeError(new AggregateError([], ''))).toBe('AggregateError');
  });
});
