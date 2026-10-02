import test from 'node:test';
import assert from 'node:assert/strict';
import {presenceItemKey} from '../src/presence-identity.js';
const base={kind:'music',title:'Song',subtitle:'Artist'};
test('same title and artist with different media-item IDs are different items',()=>{
 const a=presenceItemKey({...base,artwork:{provider:'plex',itemId:'1'}}),b=presenceItemKey({...base,artwork:{provider:'plex',itemId:'2'}});
 assert.notEqual(a,b);
});
test('a shared image ID or new image tag does not change the item',()=>{
 assert.equal(presenceItemKey({...base,artwork:{imageId:'x',tag:'1'}}),presenceItemKey({...base,artwork:{imageId:'x',tag:'2'}}));
});
test('item IDs are trimmed and blank IDs fall back to display details',()=>{
 assert.equal(presenceItemKey({...base,artwork:{provider:'plex',itemId:' 7 '}}),presenceItemKey({...base,artwork:{provider:'plex',itemId:'7'}}));
 assert.equal(presenceItemKey({...base,artwork:{itemId:'   '}}),presenceItemKey(base));
});
test('the same ID from a different provider is a different item',()=>{
 assert.notEqual(presenceItemKey({...base,artwork:{provider:'plex',itemId:'1'}}),presenceItemKey({...base,artwork:{provider:'jellyfin',itemId:'1'}}));
});
test('missing presence does not throw',()=>{assert.equal(typeof presenceItemKey(undefined),'string');assert.equal(typeof presenceItemKey(null),'string');});
