import { describe, expect, it } from 'vitest';
import { CodeListing, ListingSection } from '@shared/api/code-listing';
import { filterToSource } from './generated-code';

/**
 * Builds a section with a source path.
 * @param id The section id.
 * @param sourcePath The source path it reports, or undefined when it reports none.
 * @returns Returns the section.
 */
function section(id: string, sourcePath?: string): ListingSection {
  return { id, title: id, sourcePath, rows: [{ mnemonic: 'nop', operands: '' }] };
}

/**
 * Builds a listing over some sections.
 * @param sections The sections.
 * @returns Returns the listing.
 */
function listing(sections: readonly ListingSection[]): CodeListing {
  return {
    language: '.NET IL',
    addressing: 'method-relative',
    origin: { kind: 'buffer', path: '/p/bin/a.dll' },
    sections,
  };
}

describe('filterToSource', (): void => {
  it('keeps only the sections compiled from the open file', (): void => {
    const result: CodeListing = filterToSource(
      listing([section('a', '/p/Shapes.cs'), section('b', '/p/Other.cs')]),
      '/p/Shapes.cs',
    );
    expect(result.sections.map((entry: ListingSection): string => entry.id)).toEqual(['a']);
  });

  it('matches a bare file name against a full path, as JVM reports it', (): void => {
    // A class file records no directory, so its SourceFile attribute is a bare name. Comparing it as
    // though it were a path would match nothing at all.
    const result: CodeListing = filterToSource(
      listing([section('a', 'Fixture.java'), section('b', 'Other.java')]),
      '/p/src/main/java/Fixture.java',
    );
    expect(result.sections.map((entry: ListingSection): string => entry.id)).toEqual(['a']);
  });

  it('ignores separator and case differences between paths', (): void => {
    const result: CodeListing = filterToSource(
      listing([section('a', 'C:\\Proj\\Shapes.cs')]),
      'c:/proj/shapes.cs',
    );
    expect(result.sections).toHaveLength(1);
  });

  it('returns nothing when the file contributed nothing to the build', (): void => {
    const result: CodeListing = filterToSource(
      listing([section('a', '/p/Other.cs')]),
      '/p/Shapes.cs',
    );
    expect(result.sections).toEqual([]);
  });

  it('returns the whole listing when no section says where it came from', (): void => {
    // Showing everything is a worse answer than showing the right thing, and a much better one than
    // showing nothing — which is what filtering on absent data would produce.
    const whole: CodeListing = listing([section('a'), section('b')]);
    expect(filterToSource(whole, '/p/Shapes.cs').sections).toHaveLength(2);
  });

  it('does not treat a section with no source path as a match when others have one', (): void => {
    const result: CodeListing = filterToSource(
      listing([section('a', '/p/Shapes.cs'), section('b')]),
      '/p/Shapes.cs',
    );
    expect(result.sections.map((entry: ListingSection): string => entry.id)).toEqual(['a']);
  });
});
