"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const BACKGROUND_PATH = path.join(__dirname, "..", "background.js");

function loadBackgroundFixture(initialStore = {}) {
  const source = fs.readFileSync(BACKGROUND_PATH, "utf8");
  const store = { ...initialStore };
  const contextMenuCreateCalls = [];
  const setCalls = [];
  const noopListener = { addListener() {} };
  const context = vm.createContext({
    TextEncoder,
    URL,
    console,
    setTimeout() {},
    chrome: {
      action: {
        setBadgeBackgroundColor: async () => {},
        setBadgeText: async () => {}
      },
      contextMenus: {
        create(payload, callback) {
          contextMenuCreateCalls.push(payload);
          callback?.();
        },
        onClicked: noopListener,
        removeAll(callback) {
          callback?.();
        }
      },
      i18n: {
        getMessage() {
          return "";
        }
      },
      runtime: {
        lastError: null,
        onInstalled: noopListener,
        onMessage: noopListener,
        onStartup: noopListener
      },
      storage: {
        onChanged: noopListener,
        sync: {
          get: async (defaults) => ({ ...defaults, ...store }),
          set: async (payload) => {
            setCalls.push(payload);
            Object.assign(store, payload);
          }
        }
      },
      tabs: {
        query: async () => [],
        update: async () => {}
      }
    }
  });

  vm.runInContext(source, context, { filename: BACKGROUND_PATH });
  return { context, contextMenuCreateCalls, setCalls, store };
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("service worker startup registers the page context menu", () => {
  const fixture = loadBackgroundFixture();

  assert.deepEqual(toPlain(fixture.contextMenuCreateCalls), [
    {
      id: "quick-side-nav-add-page-preset",
      title: "Add this page to URL presets",
      contexts: ["page"],
      documentUrlPatterns: ["http://*/*", "https://*/*"]
    }
  ]);
});

test("context menu registration adds the current page as a URL preset", async () => {
  const fixture = loadBackgroundFixture({ urlPresets: [] });

  const result = await fixture.context.addCurrentPageUrlPreset(
    { pageUrl: "HTTPS://EXAMPLE.COM/path" },
    { title: " Example Page " }
  );

  assert.equal(result.added, true);
  assert.equal(fixture.setCalls.length, 1);
  assert.deepEqual(toPlain(fixture.store.urlPresets), [
    {
      id: fixture.store.urlPresets[0].id,
      label: "Example Page",
      targetUrl: "https://example.com/path"
    }
  ]);
  assert.match(fixture.store.urlPresets[0].id, /^preset-/);
});

test("context menu registration reuses an existing preset with the same URL", async () => {
  const existingPreset = {
    id: "preset-existing",
    label: "Existing",
    targetUrl: "https://example.com/path"
  };
  const fixture = loadBackgroundFixture({ urlPresets: [existingPreset] });

  const result = await fixture.context.addCurrentPageUrlPreset(
    { pageUrl: "https://example.com/path" },
    { title: "Duplicate" }
  );

  assert.equal(result.added, false);
  assert.equal(result.preset.id, "preset-existing");
  assert.equal(fixture.setCalls.length, 0);
});
