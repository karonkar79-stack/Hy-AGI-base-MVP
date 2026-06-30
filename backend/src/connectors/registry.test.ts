// src/connectors/registry.test.ts
import { detectReferences, findConnector, LARK_CONNECTORS } from './registry';

describe('reference detection', () => {
  it('detects a Lark docx URL as lark_doc', () => {
    const refs = detectReferences('please read https://acme.larksuite.com/docx/Abc123XYZ thanks');
    expect(refs).toEqual([
      { connectorType: 'lark_doc', ref: 'https://acme.larksuite.com/docx/Abc123XYZ' },
    ]);
  });

  it('detects wiki and drive-folder URLs with their refs', () => {
    const text =
      'wiki https://acme.feishu.cn/wiki/Wiki777 and folder https://acme.feishu.cn/drive/folder/Fold888';
    expect(detectReferences(text)).toEqual([
      { connectorType: 'lark_wiki', ref: 'https://acme.feishu.cn/wiki/Wiki777' },
      { connectorType: 'lark_drive', ref: 'https://acme.feishu.cn/drive/folder/Fold888' },
    ]);
  });

  it('detects a URL followed by sentence punctuation', () => {
    expect(detectReferences('read https://acme.larksuite.com/docx/Abc123XYZ.')).toEqual([
      { connectorType: 'lark_doc', ref: 'https://acme.larksuite.com/docx/Abc123XYZ' },
    ]);
  });

  it('returns nothing for plain prose or non-Lark URLs', () => {
    expect(detectReferences('no links here, just text')).toEqual([]);
    expect(detectReferences('see https://example.com/page')).toEqual([]);
  });

  it('extractToken pulls the token out of a docx URL', () => {
    const doc = findConnector('lark_doc')!;
    expect(doc.extractToken('https://acme.larksuite.com/docx/Abc123XYZ')).toBe('Abc123XYZ');
  });

  it('extractToken keeps hyphens and underscores in the token', () => {
    const doc = findConnector('lark_doc')!;
    expect(doc.extractToken('https://acme.larksuite.com/docx/doxcnAB-cd_12')).toBe('doxcnAB-cd_12');
  });

  it('LARK_CONNECTORS exposes doc, wiki, drive', () => {
    expect(LARK_CONNECTORS.map((c) => c.type).sort()).toEqual(
      ['lark_doc', 'lark_drive', 'lark_wiki'].sort()
    );
  });
});
