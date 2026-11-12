"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const optionsPath = path.join(__dirname, "..", "options.js");
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture({ stored = {}, set = () => Promise.resolve() } = {}) {
  const elements = {};
  const listeners = new Map();
  const timers = new Map();
  let nextTimer = 0;
  const writes = [];
  for (const id of ["twoTabEnabled", "twoTabSubUrl", "twoTabMainUrl", "twoTabDelayMs", "twoTabKeyDisplay", "twoTabCaptureKey", "twoTabClearKey", "saveButton", "settingsForm", "statusMessage"]) {
    const attrs = new Map();
    elements[id] = {
      dataset: {}, disabled: false, textContent: "", value: "", checked: false,
      setAttribute(name, value) { attrs.set(name, String(value)); },
      getAttribute(name) { return attrs.get(name); },
      removeAttribute(name) { attrs.delete(name); },
      addEventListener(type, handler) { this[type] = handler; },
      focus() { this.focused = true; }
    };
  }
  const controls = Object.values(elements);
  elements.settingsForm.querySelectorAll = (selector) => selector === "button, input, select"
    ? controls : controls.filter((control) => control.dataset.disabledForSave === "true");
  const context = vm.createContext({
    URL, TextEncoder, console,
    chrome: { storage: { sync: {
      async get(defaults) { return { ...defaults, ...stored }; },
      set(payload) { writes.push(plain(payload)); return set(payload); }
    } } },
    document: {
      addEventListener() {},
      getElementById(id) { return elements[id] || null; },
      querySelectorAll() { return []; }
    },
    window: {
      setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); },
      addEventListener(type, handler) { listeners.set(type, handler); },
      removeEventListener(type) { listeners.delete(type); }
    }
  });
  vm.runInContext(fs.readFileSync(optionsPath, "utf8"), context, { filename: optionsPath });
  vm.runInContext("renderRules = () => {}; renderPresets = () => {}; rules = [createDefaultRule()];", context);
  const state = () => plain(vm.runInContext("({ twoTabSettings, hasUnsavedChanges, isSaving, isCapturingKey })", context));
  const seed = (settings) => {
    context.__settings = settings;
    vm.runInContext("twoTabSettings = __settings; hasUnsavedChanges = true;", context);
    delete context.__settings;
  };
  return { context, elements, listeners, timers, writes, state, seed };
}

function validSettings(context, overrides = {}) {
  return { ...plain(context.createDefaultTwoTabSettings()), enabled: true,
    subUrl: "https://sub.example/path", mainUrl: "https://main.example/path", ...overrides };
}

function keyRule(code, overrides = {}) {
  return {
    id: `rule-${code}`, enabled: true, triggerType: "key",
    triggerKey: { code, key: code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...overrides }
  };
}

test("existing installations load two-tab coordination disabled with empty URLs and R", async () => {
  const { context } = fixture();
  const saved = plain(await context.getSavedSettings());
  assert.deepEqual(saved.twoTabSettings, plain(context.createDefaultTwoTabSettings()));
});

test("enabled sequences require both safe URLs, a key, and an integer wait", () => {
  const { context } = fixture();
  assert.equal(context.getTwoTabValidationError(validSettings(context), []), null);
  for (const field of ["subUrl", "mainUrl"]) {
    for (const value of ["", "javascript:alert(1)", "https://user:secret@example.com/", "https://example.com/" + "a".repeat(2048)]) {
      assert.equal(context.getTwoTabValidationError(validSettings(context, { [field]: value }), []).field, field);
    }
  }
  for (const delayMs of ["", -1, 10001, 1.5, "1e3", "0x10", "NaN"]) {
    assert.equal(context.getTwoTabValidationError(validSettings(context, { delayMs }), []).field, "delayMs");
  }
  for (const delayMs of [0, "0", 300, "10000"]) {
    assert.equal(context.getTwoTabValidationError(validSettings(context, { delayMs }), []), null);
  }
  for (const triggerKey of [null, { code: "", key: "" }, { code: "ControlLeft", key: "Control" }]) {
    assert.equal(context.getTwoTabValidationError(validSettings(context, { triggerKey }), []).field, "triggerKey");
  }
});

test("F1, F2, and the run key conflict only with enabled exact key combinations", () => {
  const { context } = fixture();
  const settings = validSettings(context);
  for (const code of ["F1", "F2", "KeyR"]) {
    assert.equal(context.getTwoTabValidationError(settings, [keyRule(code)]).field, "triggerKey");
    assert.equal(context.getTwoTabValidationError(settings, [{ ...keyRule(code), enabled: false }]), null);
    assert.equal(context.getTwoTabValidationError(settings, [keyRule(code, { ctrlKey: true })]), null);
  }
  for (const code of ["F1", "F2"]) {
    const triggerKey = keyRule(code).triggerKey;
    assert.equal(context.getTwoTabValidationError({ ...settings, triggerKey }, []).field, "triggerKey");
    assert.equal(context.getTwoTabValidationError({ ...settings, triggerKey: { ...triggerKey, shiftKey: true } }, []), null);
  }
  assert.equal(context.getTwoTabValidationError(settings, [keyRule("KeyQ")]), null);
});

test("disabled settings retain prepared values, allow empty URLs, and reject unsafe URLs", async () => {
  const f = fixture();
  const settings = validSettings(f.context, { enabled: false, subUrl: "  HTTPS://sub.example/path  ", mainUrl: "", delayMs: "500" });
  assert.equal(f.context.getTwoTabValidationError(settings, [keyRule("KeyR")]), null);
  f.seed(settings);
  await f.context.saveSettings();
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].twoTabSettings, { ...settings, subUrl: "https://sub.example/path", delayMs: 500 });
  assert.equal(f.state().hasUnsavedChanges, false);
  assert.equal(f.context.getTwoTabValidationError({ ...settings, subUrl: "https://user:secret@example.com" }, []).field, "subUrl");
});

test("invalid settings block the single storage write and focus the invalid field", async () => {
  const f = fixture();
  f.seed(validSettings(f.context, { mainUrl: "" }));
  await f.context.saveSettings();
  assert.equal(f.writes.length, 0);
  assert.equal(f.state().hasUnsavedChanges, true);
  assert.equal(f.elements.twoTabMainUrl.getAttribute("aria-invalid"), "true");
  assert.equal(f.elements.twoTabMainUrl.focused, true);
  assert.equal(f.elements.statusMessage.className, "status error");
});

test("two-tab settings participate in storage quota checks", () => {
  const { context } = fixture();
  const oversized = validSettings(context, { triggerKey: { code: "KeyR", displayName: "あ".repeat(3000) } });
  assert.ok(context.getStorageSizeError([], [], oversized));
});

test("pending saves suppress repeated writes and restore control state", async () => {
  let finish;
  const f = fixture({ set: () => new Promise((resolve) => { finish = resolve; }) });
  f.seed(validSettings(f.context));
  const first = f.context.saveSettings();
  await f.context.saveSettings();
  assert.equal(f.writes.length, 1);
  assert.equal(f.elements.twoTabSubUrl.disabled, true);
  finish();
  await first;
  assert.equal(f.state().isSaving, false);
  assert.equal(f.elements.twoTabSubUrl.disabled, false);
  assert.equal(f.elements.twoTabCaptureKey.disabled, false);
});

function captureEvent(key, code = key) {
  return { key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
    preventDefault() {}, stopPropagation() {} };
}

test("two-tab key recording shares cancellation, timeout, and blur cleanup", () => {
  for (const end of ["escape", "timeout", "blur"]) {
    const f = fixture();
    f.context.renderTwoTabSettings();
    f.context.startKeyCapture("two-tab-settings", f.elements.twoTabCaptureKey);
    assert.equal(f.elements.twoTabCaptureKey.disabled, true);
    if (end === "escape") f.listeners.get("keydown")(captureEvent("Escape"));
    if (end === "timeout") [...f.timers.values()][0]();
    if (end === "blur") f.listeners.get("blur")();
    assert.equal(f.state().isCapturingKey, false, end);
    assert.equal(f.elements.twoTabCaptureKey.disabled, false, end);
    assert.equal(f.state().twoTabSettings.triggerKey.code, "KeyR", end);
    assert.equal(f.state().hasUnsavedChanges, false, end);
    assert.equal(f.listeners.size, 0, end);
    assert.equal(f.timers.size, 0, end);
  }
});

test("recording a new run key marks settings dirty and modifier-only recording preserves the old key", () => {
  const f = fixture();
  f.context.startKeyCapture("two-tab-settings", f.elements.twoTabCaptureKey);
  f.listeners.get("keydown")(captureEvent("g", "KeyG"));
  assert.equal(f.state().twoTabSettings.triggerKey.code, "KeyG");
  assert.equal(f.state().hasUnsavedChanges, true);
  assert.equal(f.elements.twoTabKeyDisplay.textContent, "G");
  f.context.startKeyCapture("two-tab-settings", f.elements.twoTabCaptureKey);
  f.listeners.get("keydown")(captureEvent("Control", "ControlLeft"));
  assert.equal(f.state().twoTabSettings.triggerKey.code, "KeyG");
  assert.equal(f.state().isCapturingKey, false);
  assert.equal(f.elements.statusMessage.className, "status error");
});
