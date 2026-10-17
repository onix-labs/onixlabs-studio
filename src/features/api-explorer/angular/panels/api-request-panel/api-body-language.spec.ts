import { describe, expect, it } from 'vitest';
import { languageForBodyKind, languageForContentType } from './api-body-language';

describe('languageForBodyKind', () => {
  it('textKinds_mapToTheirGrammar_andTheRest_toPlainText', () => {
    expect(languageForBodyKind('json')).toBe('json');
    expect(languageForBodyKind('xml')).toBe('xml');
    expect(languageForBodyKind('text')).toBe('plaintext');
    expect(languageForBodyKind('none')).toBe('plaintext');
    expect(languageForBodyKind('form')).toBe('plaintext');
    expect(languageForBodyKind('urlencoded')).toBe('plaintext');
  });
});

describe('languageForContentType', () => {
  it('json_includingSuffixForms_andParameters_isJson', () => {
    expect(languageForContentType('application/json')).toBe('json');
    expect(languageForContentType('application/json; charset=utf-8')).toBe('json');
    expect(languageForContentType('application/problem+json')).toBe('json');
    expect(languageForContentType('Application/JSON')).toBe('json');
  });

  it('xml_includingSuffixForms_isXml', () => {
    expect(languageForContentType('application/xml')).toBe('xml');
    expect(languageForContentType('text/xml; charset=utf-8')).toBe('xml');
    expect(languageForContentType('image/svg+xml')).toBe('xml');
    expect(languageForContentType('application/atom+xml')).toBe('xml');
  });

  it('html_css_javascript_andYaml_haveTheirOwnGrammars', () => {
    expect(languageForContentType('text/html; charset=utf-8')).toBe('html');
    expect(languageForContentType('application/xhtml+xml')).toBe('html');
    expect(languageForContentType('text/css')).toBe('css');
    expect(languageForContentType('text/javascript')).toBe('javascript');
    expect(languageForContentType('application/javascript')).toBe('javascript');
    expect(languageForContentType('application/yaml')).toBe('yaml');
    expect(languageForContentType('text/x-yaml')).toBe('yaml');
  });

  it('unknown_orMissing_isPlainText', () => {
    expect(languageForContentType(undefined)).toBe('plaintext');
    expect(languageForContentType('')).toBe('plaintext');
    expect(languageForContentType('text/plain')).toBe('plaintext');
    expect(languageForContentType('application/octet-stream')).toBe('plaintext');
  });
});
