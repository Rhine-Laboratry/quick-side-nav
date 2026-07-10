"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadScript(fileName) {
  const source = fs.readFileSync(path.join(__dirname, "..", fileName), "utf8");
  const noopListener = { addListener() {} };
  class FakeElement {
    closest() {
      return null;
    }
  }

  const context = vm.createContext({
    Element: FakeElement,
    URL,
    console,
    document: {
      addEventListener() {
        // Popup initialization is not needed for these validation tests.
      }
    },
    window: {
      addEventListener() {}
    },
    chrome: {
      action: {
        setBadgeBackgroundColor: async () => {},
        setBadgeText: async () => {}
      },
      runtime: {
        onInstalled: noopListener,
        onMessage: noopListener,
        onStartup: noopListener,
        sendMessage() {},
        lastError: null
      },
      storage: {
        onChanged: noopListener,
        sync: {
          get: async (defaults) => defaults
        }
      },
      tabs: {
        query: async () => [],
        update: async () => {}
      }
    }
  });

  vm.runInContext(source, context, { filename: fileName });
  return context;
}

for (const fileName of ["background.js", "popup.js", "content.js"]) {
  test(`${fileName} rejects unsafe URLs even if sync storage is corrupted`, () => {
    const runtime = loadScript(fileName);
    const isValidUrl = (value) => Boolean(runtime.normalizeValidUrl(value));

    assert.equal(isValidUrl("https://example.com/path"), true);
    assert.equal(isValidUrl("https:example.com"), false);
    assert.equal(isValidUrl("https://user:secret@example.com/"), false);
    assert.equal(isValidUrl(`https://example.com/${"あ".repeat(700)}`), false);
    assert.equal(isValidUrl(`https://example.com/${"a".repeat(3000)}`), false);
  });

  test(`${fileName} never replaces an invalid current rules array with the default route`, () => {
    const runtime = loadScript(fileName);
    const rules = runtime.getRulesFromStorage({
      rules: [
        {
          id: "unsafe-rule",
          targetUrl: "https://user:secret@example.com/",
          triggerType: "mouse",
          mouseButton: "side",
          triggerKey: null
        }
      ],
      targetUrl: "https://example.com/",
      triggerType: "mouse",
      triggerKey: null
    });

    assert.equal(rules.length, 0);
  });
}
