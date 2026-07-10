"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const OPTIONS_PATH = path.join(__dirname, "..", "options.js");

function createElement({ disabled = false, textContent = "" } = {}) {
  const attributes = new Map();

  return {
    className: "",
    dataset: {},
    disabled,
    textContent,
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    }
  };
}

function createDom() {
  const saveButton = createElement({ textContent: "保存" });
  const enabledControl = createElement();
  const initiallyDisabledControl = createElement({ disabled: true });
  const controls = [saveButton, enabledControl, initiallyDisabledControl];
  const form = createElement();
  const status = createElement();

  form.querySelectorAll = (selector) => {
    if (selector === "button, input, select") {
      return controls;
    }

    if (selector === "[data-disabled-for-save='true']") {
      return controls.filter((control) => control.dataset.disabledForSave === "true");
    }

    return [];
  };

  const elements = {
    saveButton,
    settingsForm: form,
    statusMessage: status
  };

  return {
    controls: {
      enabledControl,
      initiallyDisabledControl,
      saveButton
    },
    document: {
      addEventListener() {
        // Do not dispatch DOMContentLoaded in this VM fixture.
      },
      getElementById(id) {
        return elements[id] || null;
      },
      querySelectorAll() {
        return [];
      }
    },
    form,
    status
  };
}

function loadSaveFixture(setImplementation) {
  const source = fs.readFileSync(OPTIONS_PATH, "utf8");
  const dom = createDom();
  const setCalls = [];
  const context = vm.createContext({
    Blob,
    TextEncoder,
    URL,
    chrome: {
      storage: {
        sync: {
          QUOTA_BYTES_PER_ITEM: 8192,
          set(payload) {
            setCalls.push(payload);
            return setImplementation(payload);
          }
        }
      }
    },
    console,
    document: dom.document
  });

  vm.runInContext(source, context, { filename: OPTIONS_PATH });
  vm.runInContext(
    "renderPresets = function () {}; renderRules = function () {};",
    context
  );

  return { context, dom, setCalls };
}

function seedSettings(context, { presets = [], rules, dirty = true }) {
  context.__testPresets = presets;
  context.__testRules = rules;
  context.__testDirty = dirty;

  vm.runInContext(
    "urlPresets = __testPresets; rules = __testRules; "
      + "hasUnsavedChanges = __testDirty; isSaving = false;",
    context
  );

  delete context.__testPresets;
  delete context.__testRules;
  delete context.__testDirty;
}

function readInternalState(context) {
  return vm.runInContext(
    "({ hasUnsavedChanges, isSaving, rules, urlPresets })",
    context
  );
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeRule(overrides = {}) {
  return {
    id: "rule-1",
    targetUrl: "https://rule.example/",
    triggerType: "mouse",
    mouseButton: "3",
    triggerKey: null,
    presetId: "",
    ...overrides
  };
}

test("a rejected sync write shows an error and preserves unsaved changes", async () => {
  const fixture = loadSaveFixture(() =>
    Promise.reject(new Error("QUOTA_BYTES_PER_ITEM quota exceeded"))
  );
  seedSettings(fixture.context, {
    rules: [makeRule()]
  });

  await fixture.context.saveSettings();

  const state = readInternalState(fixture.context);
  assert.equal(fixture.setCalls.length, 1);
  assert.equal(state.hasUnsavedChanges, true);
  assert.equal(state.isSaving, false);
  assert.equal(fixture.dom.status.className, "status error");
  assert.match(fixture.dom.status.textContent, /上限.*保存できません/);
  assert.doesNotMatch(fixture.dom.status.textContent, /QUOTA_BYTES_PER_ITEM/);
});

test("a successful save writes normalized settings and clears unsaved changes", async () => {
  const fixture = loadSaveFixture(() => Promise.resolve());
  seedSettings(fixture.context, {
    presets: [
      {
        id: "preset-1",
        label: "  Work dashboard  ",
        targetUrl: "  https://preset.example/current  "
      }
    ],
    rules: [
      makeRule({
        targetUrl: "https://stale-snapshot.example/",
        presetId: "preset-1"
      })
    ]
  });

  await fixture.context.saveSettings();

  assert.equal(fixture.setCalls.length, 1);
  assert.deepEqual(toPlain(fixture.setCalls[0]), {
    urlPresets: [
      {
        id: "preset-1",
        label: "Work dashboard",
        targetUrl: "https://preset.example/current"
      }
    ],
    rules: [
      {
        id: "rule-1",
        targetUrl: "https://preset.example/current",
        triggerType: "mouse",
        mouseButton: "3",
        triggerKey: null,
        presetId: "preset-1"
      }
    ],
    targetUrl: "https://preset.example/current",
    triggerType: "mouse",
    triggerKey: null
  });

  const state = toPlain(readInternalState(fixture.context));
  const savedPayload = toPlain(fixture.setCalls[0]);
  assert.equal(state.hasUnsavedChanges, false);
  assert.equal(state.isSaving, false);
  assert.deepEqual(state.urlPresets, savedPayload.urlPresets);
  assert.deepEqual(state.rules, savedPayload.rules);
  assert.equal(fixture.dom.status.className, "status success");
  assert.equal(fixture.dom.status.textContent, "保存しました。");
});

test("setSavingState restores save button disabled and aria-busy state", () => {
  const fixture = loadSaveFixture(() => Promise.resolve());
  const { enabledControl, initiallyDisabledControl, saveButton } = fixture.dom.controls;

  fixture.context.setSavingState(true);

  assert.equal(saveButton.disabled, true);
  assert.equal(saveButton.getAttribute("aria-busy"), "true");
  assert.equal(saveButton.textContent, "保存中");
  assert.equal(enabledControl.disabled, true);
  assert.equal(initiallyDisabledControl.disabled, true);
  assert.equal(fixture.dom.form.getAttribute("aria-busy"), "true");

  fixture.context.setSavingState(false);

  assert.equal(saveButton.disabled, false);
  assert.equal(saveButton.getAttribute("aria-busy"), "false");
  assert.equal(saveButton.textContent, "保存");
  assert.equal(saveButton.dataset.disabledForSave, undefined);
  assert.equal(enabledControl.disabled, false);
  assert.equal(enabledControl.dataset.disabledForSave, undefined);
  assert.equal(initiallyDisabledControl.disabled, true);
  assert.equal(fixture.dom.form.getAttribute("aria-busy"), "false");
});
