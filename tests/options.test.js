"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const OPTIONS_PATH = path.join(__dirname, "..", "options.js");
const SYNC_ITEM_LIMIT_BYTES = 8192;

function loadOptionsFunctions() {
  const source = fs.readFileSync(OPTIONS_PATH, "utf8");
  const context = vm.createContext({
    Blob,
    TextEncoder,
    URL,
    chrome: {
      storage: {
        sync: {
          QUOTA_BYTES_PER_ITEM: SYNC_ITEM_LIMIT_BYTES
        }
      }
    },
    console,
    document: {
      addEventListener() {
        // Do not fire DOMContentLoaded. These tests exercise pure helpers only.
      }
    }
  });

  vm.runInContext(source, context, { filename: OPTIONS_PATH });
  return context;
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeMouseRule(overrides = {}) {
  return {
    id: "rule-1",
    targetUrl: "https://rule.example/",
    triggerType: "mouse",
    mouseButton: "3",
    triggerKey: null,
    ...overrides
  };
}

function makeKeyRule(id, overrides = {}) {
  return {
    id,
    targetUrl: `https://${id}.example/`,
    triggerType: "key",
    mouseButton: "side",
    triggerKey: {
      code: "KeyG",
      key: "g",
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      displayName: "Ctrl + G"
    },
    presetId: "",
    ...overrides
  };
}

test("pre-preset rules migrate as direct URL rules", () => {
  const options = loadOptionsFunctions();
  const result = {
    rules: [
      makeMouseRule({
        id: "pre-preset-rule",
        targetUrl: "  https://legacy.example/path  "
      })
    ],
    targetUrl: "https://unused.example/",
    triggerType: "mouse",
    triggerKey: null
  };

  const rules = toPlain(options.getRulesFromStorage(result, []));

  assert.deepEqual(rules, [
    {
      id: "pre-preset-rule",
      targetUrl: "https://legacy.example/path",
      triggerType: "mouse",
      mouseButton: "3",
      triggerKey: null,
      presetId: ""
    }
  ]);
});

test("a referenced preset is the source of the normalized rule URL", () => {
  const options = loadOptionsFunctions();
  const presets = [
    {
      id: "preset-1",
      label: "Current destination",
      targetUrl: "https://preset.example/current"
    }
  ];
  const result = {
    rules: [
      makeMouseRule({
        targetUrl: "https://stale-snapshot.example/",
        presetId: "preset-1"
      })
    ]
  };

  const [rule] = toPlain(options.getRulesFromStorage(result, presets));

  assert.equal(rule.presetId, "preset-1");
  assert.equal(rule.targetUrl, "https://preset.example/current");
});

test("a missing preset falls back to the rule's own URL snapshot", () => {
  const options = loadOptionsFunctions();
  const result = {
    rules: [
      makeMouseRule({
        targetUrl: "https://snapshot.example/fallback",
        presetId: "deleted-preset"
      })
    ]
  };

  const [rule] = toPlain(options.getRulesFromStorage(result, []));

  assert.equal(rule.presetId, "");
  assert.equal(rule.targetUrl, "https://snapshot.example/fallback");
});

test("legacy URLs that violate new safeguards remain visible for correction", () => {
  const options = loadOptionsFunctions();
  const longUrl = `https://long.example/${"a".repeat(3000)}`;
  const result = {
    urlPresets: [
      {
        id: "legacy-credential-preset",
        label: "Legacy private URL",
        targetUrl: "https://user:secret@example.com/"
      }
    ],
    rules: [
      makeMouseRule({
        id: "legacy-long-rule",
        targetUrl: longUrl,
        presetId: ""
      })
    ]
  };

  const presets = toPlain(options.getUrlPresetsFromStorage(result));
  const rules = toPlain(options.getRulesFromStorage(result, presets));

  assert.equal(presets[0].targetUrl, "https://user:secret@example.com/");
  assert.equal(rules[0].targetUrl, longUrl);
  assert.equal(options.isSelectablePreset(presets[0]), false);
  assert.ok(options.getPresetValidationError(presets[0], 0));
  assert.ok(options.getRuleValidationError(rules[0], 0, presets));
});

test("overlapping mouse and identical keyboard triggers are rejected", () => {
  const options = loadOptionsFunctions();

  const mouseMessage = options.findDuplicateTriggerMessage([
    makeMouseRule({ id: "all-side-buttons", mouseButton: "side" }),
    makeMouseRule({ id: "back-button", mouseButton: "3" })
  ]);
  assert.ok(mouseMessage);

  const keyMessage = options.findDuplicateTriggerMessage([
    makeKeyRule("first"),
    makeKeyRule("second")
  ]);
  assert.ok(keyMessage);

  const distinctMessage = options.findDuplicateTriggerMessage([
    makeKeyRule("first"),
    makeKeyRule("second", {
      triggerKey: {
        code: "KeyG",
        key: "G",
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
        metaKey: false,
        displayName: "Ctrl + Shift + G"
      }
    })
  ]);
  assert.equal(distinctMessage, "");
});

test("URL validation accepts only explicit credential-free http(s) URLs of bounded length", () => {
  const options = loadOptionsFunctions();

  for (const value of [
    "http://example.com/",
    "https://example.com/path?query=1#section"
  ]) {
    assert.equal(options.isValidUrl(value), true, value);
  }

  for (const value of [
    "https:example.com",
    "http:example.com",
    "https://user@example.com/",
    "https://user:secret@example.com/",
    "ftp://example.com/",
    "javascript:alert(1)",
    `https://example.com/${"あ".repeat(700)}`,
    `https://example.com/${"a".repeat(10000)}`
  ]) {
    assert.equal(options.isValidUrl(value), false, value.slice(0, 120));
  }

  const normalized = options.normalizeValidUrl("HTTPS://EXAMPLE.COM/path");
  assert.equal(normalized, "https://example.com/path");
  assert.equal(options.normalizeValidUrl(normalized), normalized);
});

test("normalizeUrlPreset trims labels and caps them at the UI maximum", () => {
  const options = loadOptionsFunctions();
  const shortLabel = options.normalizeUrlPreset({
    id: "preset-short",
    label: "  Work dashboard  ",
    targetUrl: "https://dashboard.example/"
  });
  assert.equal(shortLabel.label, "Work dashboard");

  const longLabel = options.normalizeUrlPreset({
    id: "preset-long",
    label: `  ${"x".repeat(100)}  `,
    targetUrl: "https://long-label.example/"
  });
  assert.equal(longLabel.label, "x".repeat(80));
  assert.equal(longLabel.label.length, 80);
});

test("getStorageSizeError enforces the 8192-byte limit for each sync item", () => {
  const options = loadOptionsFunctions();
  assert.equal(Boolean(options.getStorageSizeError([], [])), false);

  const utf8HeavyPresets = Array.from({ length: 30 }, (_, index) => ({
    id: `preset-${index}`,
    label: "\u3042".repeat(80),
    targetUrl: `https://preset-${index}.example/`
  }));
  const serializedPresets = `urlPresets${JSON.stringify(utf8HeavyPresets)}`;
  assert.ok(serializedPresets.length < SYNC_ITEM_LIMIT_BYTES);
  assert.ok(Buffer.byteLength(serializedPresets, "utf8") > SYNC_ITEM_LIMIT_BYTES);
  assert.ok(options.getStorageSizeError(utf8HeavyPresets, []));

  const oversizedRules = Array.from({ length: 24 }, (_, index) =>
    makeKeyRule(`rule-${index}`, {
      targetUrl: `https://rules.example/${"a".repeat(300)}-${index}`,
      triggerKey: {
        code: `F${index + 1}`,
        key: `F${index + 1}`,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        displayName: `F${index + 1}`
      }
    })
  );
  assert.ok(
    Buffer.byteLength(`rules${JSON.stringify(oversizedRules)}`, "utf8")
      > SYNC_ITEM_LIMIT_BYTES
  );
  assert.ok(options.getStorageSizeError([], oversizedRules));
});

test("isSelectablePreset excludes empty and invalid preset URLs", () => {
  const options = loadOptionsFunctions();

  assert.equal(options.isSelectablePreset(null), false);
  assert.equal(options.isSelectablePreset({ id: "empty", targetUrl: "" }), false);
  assert.equal(
    options.isSelectablePreset({ id: "invalid", targetUrl: "https:example.com" }),
    false
  );
  assert.equal(
    options.isSelectablePreset({
      id: "credentials",
      targetUrl: "https://user:secret@example.com/"
    }),
    false
  );
  assert.equal(
    options.isSelectablePreset({ id: "valid", targetUrl: "https://example.com/" }),
    true
  );
});
