import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
(0, eval)(fs.readFileSync(path.join(dir, '../js/utils/xmlTree.js'), 'utf8'));
const XT = globalThis.XmlTree;

test('parse → serialize 는 네임스페이스·속성·공백·엔티티를 그대로 보존', () => {
  const src = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://x/w" xmlns:r="http://x/r"><w:p w:rsidR="00A1"><w:r><w:t xml:space="preserve"> 가 &amp; 나 &lt;다&gt; </w:t></w:r><w:tab/></w:p></w:document>';
  const root = XT.parse(src);
  assert.equal(XT.serialize(root), src);
});
test('텍스트 변경 후 다시 직렬화해도 나머지는 그대로', () => {
  const root = XT.parse('<a xmlns:w="u"><w:t>old</w:t><w:b w:val="1"/></a>');
  const t = XT.descendants(root, 'w:t')[0];
  XT.setText(t, 'new & 값');
  const out = XT.serialize(root);
  assert.match(out, /<w:t>new &amp; 값<\/w:t>/);
  assert.match(out, /<w:b w:val="1"\/>/);
});
