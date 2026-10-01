import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { SERVER_SCRIPT } from "../src/settings-onboarding-page.js";

const tick = () => new Promise(resolve => setImmediate(resolve));
function page() {
  const fetches = [], elements = new Map();
  const document = { activeElement: null, getElementById: id => elements.get(id) || create(id), createElement: tag => create(null, tag) };
  function create(id, tag) {
    const node = { id, tag, value: "", hidden: false, disabled: false, textContent: "", children: [],
      addEventListener(event, fn) { this[event] = fn; }, append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; }, setAttribute(name, value) { this[name] = value; },
      contains(other) { return this === other || this.children.some(child => child.contains(other)); },
      querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); },
      focus() { document.activeElement = this; }
    };
    if(id) elements.set(id, node);
    return node;
  }
  runInNewContext(SERVER_SCRIPT, { document, fetch: (path, options) => new Promise(resolve => fetches.push({path, options, resolve: body => resolve({ok: true, json: async () => body})})), setTimeout: () => 1, clearTimeout() {}, URL, confirm: () => true, window: {open() {}} });
  return {document, fetches, node: document.getElementById};
}
const servers = [
  {provider: "plex", id: "a", name: "Living room", baseUrl: "http://192.168.1.20:32400"},
  {provider: "jellyfin", id: "b", name: "Study", baseUrl: "http://192.168.1.21:8096"},
  {provider: "emby", id: "c", name: "Bedroom", baseUrl: "http://192.168.1.22:8096"}
];
for (const move of ["removed", "remaining", "outside"]) {
  test(`server removal keeps keyboard focus safe when it is ${move}`, async () => {
    const {node, fetches, document} = page();
    fetches[0].resolve({servers}); await tick();
    const buttons = node("servers-list").querySelectorAll("button");
    buttons[0].focus(); const removal = buttons[0].click({currentTarget: buttons[0]});
    fetches[1].resolve({tokenRemoved: true}); await tick();
    if(move === "remaining") buttons[1].focus();
    if(move === "outside") node("scan-subnet").focus();
    fetches[2].resolve({servers: servers.slice(1)}); await removal;
    const expected = move === "removed" ? node("discover-servers") : move === "outside" ? node("scan-subnet") : node("servers-list").querySelectorAll("button")[0];
    assert.equal(document.activeElement, expected);
    assert.match(node("discovery-state").textContent, /Server removed/);
  });
}
