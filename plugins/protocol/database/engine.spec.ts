import { describe, expect, it } from 'vitest';
import { splitQualifiedName } from './engine';

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
