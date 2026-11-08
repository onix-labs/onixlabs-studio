import { describe, expect, it } from 'vitest';
import { child, childText, decodeEntities, descend, parseXml, XmlElement } from './xml';

describe('parseXml', () => {
  it('parseXml_aDocumentWithProlog_readsTheRootAndItsChildren', () => {
    const root: XmlElement | null = parseXml(
      '<?xml version="1.0"?>\n<project xmlns="x"><artifactId>demo</artifactId><version>1.0</version></project>',
    );

    expect(root?.name).toBe('project');
    expect(childText(root, 'artifactId')).toBe('demo');
    expect(childText(root, 'version')).toBe('1.0');
  });

  it('parseXml_commentsAndCdata_skipsCommentsAndKeepsCdataText', () => {
    const root: XmlElement | null = parseXml(
      '<a><!-- <b>hidden</b> --><c><![CDATA[1 < 2]]></c></a>',
    );

    expect(child(root, 'b')).toBeNull();
    expect(childText(root, 'c')).toBe('1 < 2');
  });

  it('parseXml_aDoctypeWithEntities_skipsItWithoutExpandingAnything', () => {
    const root: XmlElement | null = parseXml(
      '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a><b>&x;</b></a>',
    );

    expect(childText(root, 'b')).toBe('&x;');
  });

  it('parseXml_prefixedNamesAndAttributes_readsLocalNames', () => {
    const root: XmlElement | null = parseXml('<m:project m:id="1"><m:name a=\'x>y\'/></m:project>');

    expect(root?.name).toBe('project');
    expect(root?.attributes['id']).toBe('1');
    expect(child(root, 'name')?.attributes['a']).toBe('x>y');
  });

  it('parseXml_unbalancedTags_closesWhatIsLeftOpen', () => {
    const root: XmlElement | null = parseXml('<a><b>text</c></a');

    expect(childText(root, 'b')).toBe('text');
  });

  it('parseXml_noElement_answersNull', () => {
    expect(parseXml('just text')).toBeNull();
  });

  it('descend_aPath_followsChildNames', () => {
    const root: XmlElement | null = parseXml('<a><b><c>deep</c></b></a>');

    expect(descend(root, 'b/c')?.text).toBe('deep');
    expect(descend(root, 'b/missing')).toBeNull();
  });
});

describe('decodeEntities', () => {
  it('decodeEntities_predefinedAndNumeric_decodesThem', () => {
    expect(decodeEntities('&lt;&amp;&#65;&#x42;&quot;&apos;&gt;')).toBe('<&AB"\'>');
  });

  it('decodeEntities_unknownEntity_leavesIt', () => {
    expect(decodeEntities('&nbsp;')).toBe('&nbsp;');
  });
});
