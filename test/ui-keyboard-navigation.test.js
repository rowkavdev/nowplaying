import test from 'node:test';
import assert from 'node:assert/strict';
import { createStatusPageHandler } from '../src/status-page-handler.js';
import { createLogsPageHandler } from '../src/logs-page-handler.js';
import { createSettingsPageHandler } from '../src/settings-page-handler.js';

test('Status and Logs provide skip links, focus targets and visible focus style', async () => {
  const status = createStatusPageHandler({ status: { snapshot() {}, async refresh() {} }, fallback: async () => null });
  const logs = createLogsPageHandler({ readEvents: async () => [], fallback: status });
  for (const path of ['/status', '/logs']) {
    const page = (await logs({ url: path })).body;
    assert.match(page, /href="#main-content"/);
    assert.match(page, /id="main-content" tabindex="-1"/);
  }
  const css = (await status({ url:'/status-ui.css' })).body;
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.skip-link:focus/);
});
test('Settings keeps its accordion layout and makes both scroll panes keyboard reachable', async () => {
  const handler = createSettingsPageHandler({ settings: { read: () => ({}), updateDiscord: async () => {} }, fallback: async () => null });
  const page = (await handler({ url:'/settings' })).body;
  assert.match(page, /class="drpp-columns"/);
  assert.match(page, /href="#settings-content"/);
  assert.match(page, /class="drpp-config-scroll" tabindex="0"/);
  assert.match(page, /id="drpp-log-lines" tabindex="0"/);
  const css = (await handler({ url:'/drpp-shell.css' })).body;
  assert.match(css, /:focus-visible/);
});
