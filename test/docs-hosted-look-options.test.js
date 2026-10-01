import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('the hosted card guide documents every look option and notime',()=>{
 const doc=readFileSync(new URL('../docs/hosted-card.md',import.meta.url),'utf8');
 for(const key of ['fontFamily','fontStack','statusStyle','progressStyle','border','background','notime'])assert.ok(doc.includes('`'+key+'`'),key);
});
