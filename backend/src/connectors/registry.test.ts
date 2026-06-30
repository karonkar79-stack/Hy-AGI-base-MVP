// src/connectors/registry.test.ts
import { detectReferences, findConnector, LARK_CONNECTORS } from './registry';

describe('reference detection', () => {
  it('detects a Lark docx URL as lark_doc', () => {
    const refs = detectReferences('please read https://acme.larksuite.com/docx/Abc123XYZ thanks');
    expect(refs).toEqual([
      { connectorType: 'lark_doc', ref: 'https://acme.larksuite.com/docx/Abc123XYZ' },
    ]);
  });

  it('detects wiki and drive-folder URLs', () => {
    const text =
      'wiki https://acme.feishu.cn/wiki/Wiki777 and folder https://acme.feishu.cn/drive/folder/Fold888';
    const types = detectReferences(text).map((r) => r.connectorType);
    expect(types).toEqual(['lark_wiki', 'lark_drive']);
  });

  it('returns nothing for plain prose or non-Lark URLs', () => {
    expect(detectReferences('no links here, just text')).toEqual([]);
    expect(detectReferences('see https://example.com/page')).toEqual([]);
  });

  it('extractToken pulls the token out of a docx URL', () => {
    const doc = findConnector('lark_doc')!;
    expect(doc.extractToken('https://acme.larksuite.com/docx/Abc123XYZ')).toBe('Abc123XYZ');
  });

  it('LARK_CONNECTORS exposes doc, wiki, drive', () => {
    expect(LARK_CONNECTORS.map((c) => c.type).sort()).toEqual(
      ['lark_doc', 'lark_drive', 'lark_wiki'].sort()
    );
  });
});
