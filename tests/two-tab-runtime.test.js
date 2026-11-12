"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const RUN_KEY = { code: "KeyR", key: "r", displayName: "R", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
const CONFIG = { enabled: true, triggerKey: RUN_KEY, subUrl: "https://sub.example/quest", mainUrl: "https://main.example/back", delayMs: 300 };
const plain = (value) => JSON.parse(JSON.stringify(value));

function eventChannel() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    emit(...args) { for (const listener of listeners) listener(...args); },
    listeners
  };
}

async function until(predicate) {
  for (let step = 0; step < 150; step += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail("Expected asynchronous state was not reached");
}

function backgroundFixture({ config = CONFIG, targets = { mainTabId: 1, subTabId: 2 }, isEnabled = true, rules = [] } = {}) {
  const syncStore = { twoTabSettings: plain(config), isEnabled, rules };
  const sessionStore = { twoTabTargets: targets ? plain(targets) : null };
  const changed = eventChannel();
  const messages = eventChannel();
  const removed = eventChannel();
  const tabs = new Map([1, 2, 3].map((id) => [id, { id, eligible: true }]));
  const updates = [];
  const timers = [];
  const badges = [];
  const pings = [];
  const pingHooks = new Map();
  const area = (store, name) => ({
    async get(defaults) {
      return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, key in store ? store[key] : fallback]));
    },
    async set(payload) {
      const changes = {};
      for (const [key, value] of Object.entries(payload)) {
        changes[key] = { oldValue: store[key], newValue: plain(value) };
        store[key] = plain(value);
      }
      changed.emit(changes, name);
    }
  });
  const sync = area(syncStore, "sync");
  const session = area(sessionStore, "session");
  const context = vm.createContext({
    TextEncoder, URL,
    console: { error() {}, warn() {} },
    setTimeout(callback, ms) { timers.push({ callback, ms }); },
    chrome: {
      runtime: { onInstalled: eventChannel(), onStartup: eventChannel(), onMessage: messages },
      storage: { sync, session, onChanged: changed },
      action: { async setBadgeBackgroundColor() {}, async setBadgeText(value) { badges.push(value.text); } },
      tabs: {
        onRemoved: removed,
        async get(id) {
          if (!tabs.has(id)) throw new Error("No tab");
          return { id }; // URL metadata intentionally unavailable without tabs permission.
        },
        async query() { return tabs.has(3) ? [{ id: 3 }] : []; },
        async sendMessage(id, message, options) {
          pings.push({ id, message, options });
          if (!tabs.has(id) || !tabs.get(id).eligible) throw new Error("No receiver");
          if (pingHooks.has(id)) await pingHooks.get(id)();
          return { eligible: true };
        },
        async update(id, properties) {
          if (!tabs.has(id)) throw new Error("No tab");
          updates.push({ id, ...plain(properties) });
        }
      }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "background.js"), "utf8"), context);
  return {
    context, syncStore, sessionStore, sync, session, tabs, updates, timers, badges, pings, pingHooks,
    send(message, sender = {}) {
      return new Promise((resolve) => {
        const handled = messages.listeners[0](message, sender, (response) => resolve(plain(response)));
        if (!handled) resolve(undefined);
      });
    },
    close(id) { tabs.delete(id); removed.emit(id); },
    async finishDelay(ms = 300) {
      await until(() => timers.some((timer) => timer.ms === ms));
      timers.splice(timers.findIndex((timer) => timer.ms === ms), 1)[0].callback();
    }
  };
}

test("two-tab manual run updates sub first, waits the configured delay, then updates main without activation", async () => {
  const fixture = backgroundFixture({ isEnabled: false });
  const running = fixture.send({ type: "two-tab-run" });
  await until(() => fixture.updates.length === 1 && fixture.timers.some((timer) => timer.ms === 300));
  assert.deepEqual(fixture.updates, [{ id: 2, url: CONFIG.subUrl }]);
  assert.deepEqual(await fixture.send({ type: "two-tab-status" }), {
    ok: true, enabled: true, configured: true, running: true, mainRegistered: true, subRegistered: true
  });
  await fixture.finishDelay();
  assert.deepEqual(await running, { ok: true });
  assert.deepEqual(fixture.updates, [{ id: 2, url: CONFIG.subUrl }, { id: 1, url: CONFIG.mainUrl }]);
  assert(fixture.pings.every((ping) => ping.message.type === "two-tab-ping" && ping.options.frameId === 0));
});

test("a concurrent run is rejected and the lock is released after completion", async () => {
  const fixture = backgroundFixture();
  const first = fixture.send({ type: "two-tab-run" });
  await until(() => fixture.updates.length === 1);
  assert.match((await fixture.send({ type: "two-tab-run" })).error, /already running/);
  assert.equal(fixture.updates.length, 1);
  await fixture.finishDelay();
  assert.equal((await first).ok, true);
  const second = fixture.send({ type: "two-tab-run" });
  await until(() => fixture.updates.length === 3);
  await fixture.finishDelay();
  assert.equal((await second).ok, true);
  assert.equal(fixture.updates.length, 4);
});

for (const delayMs of [0, 10000, undefined]) {
  test(`delay ${delayMs === undefined ? "defaults to 300 ms" : `${delayMs} ms is supported`}`, async () => {
    const config = { ...CONFIG, delayMs };
    const fixture = backgroundFixture({ config });
    const running = fixture.send({ type: "two-tab-run" });
    await until(() => fixture.updates.length === 1);
    const expectedDelay = delayMs ?? 300;
    await fixture.finishDelay(expectedDelay);
    assert.equal((await running).ok, true);
    assert.equal(fixture.updates.length, 2);
  });
}

for (const [name, options, change] of [
  ["missing registration", { targets: null }],
  ["same tab in both roles", { targets: { mainTabId: 1, subTabId: 1 } }],
  ["closed main tab", {}, (fixture) => fixture.tabs.delete(1)],
  ["ineligible sub tab", {}, (fixture) => { fixture.tabs.get(2).eligible = false; }],
  ["unsafe destination", { config: { ...CONFIG, mainUrl: "https://user:password@example.com/" } }],
  ["negative delay", { config: { ...CONFIG, delayMs: -1 } }],
  ["excessive delay", { config: { ...CONFIG, delayMs: 10001 } }],
  ["fractional delay", { config: { ...CONFIG, delayMs: 1.5 } }],
  ["string delay", { config: { ...CONFIG, delayMs: "300" } }],
  ["missing run key", { config: { ...CONFIG, triggerKey: null } }],
  ["reserved run key", { config: { ...CONFIG, triggerKey: { ...RUN_KEY, code: "F1" } } }],
  ["blank run key", { config: { ...CONFIG, triggerKey: { ...RUN_KEY, code: "   " } } }],
  ["modifier-only run key", { config: { ...CONFIG, triggerKey: { ...RUN_KEY, key: "Control", code: "KeyC" } } }],
  ["unidentified run key", { config: { ...CONFIG, triggerKey: { ...RUN_KEY, key: "Unidentified" } } }],
  ["disabled feature", { config: { ...CONFIG, enabled: false } }]
]) {
  test(`preflight rejects ${name} before either navigation`, async () => {
    const fixture = backgroundFixture(options);
    change?.(fixture);
    const response = await fixture.send({ type: "two-tab-run" });
    assert.equal(response.ok, false);
    assert.equal(typeof response.error, "string");
    assert.deepEqual(fixture.updates, []);
    await until(() => fixture.badges.includes("!"));
  });
}

test("F1 and F2 register the message sender, popup registration uses the current tab, and duplicate roles preserve earlier registration", async () => {
  const fixture = backgroundFixture({ targets: null });
  const key = (code) => ({ type: "open-configured-url", trigger: { ...RUN_KEY, type: "key", code } });
  assert.equal((await fixture.send(key("F1"), { tab: { id: 1 } })).ok, true);
  assert.equal((await fixture.send(key("F2"), { tab: { id: 2 } })).ok, true);
  assert.deepEqual(fixture.sessionStore.twoTabTargets, { mainTabId: 1, subTabId: 2 });
  const duplicate = await fixture.send({ type: "two-tab-register", role: "sub" }, { tab: { id: 1 } });
  assert.equal(duplicate.ok, false);
  assert.deepEqual(fixture.sessionStore.twoTabTargets, { mainTabId: 1, subTabId: 2 });
  assert.equal((await fixture.send({ type: "two-tab-register", role: "sub" })).ok, true);
  assert.deepEqual(fixture.sessionStore.twoTabTargets, { mainTabId: 1, subTabId: 3 });
  assert.equal((await fixture.send({ type: "two-tab-clear", role: "main" })).ok, true);
  assert.deepEqual(fixture.sessionStore.twoTabTargets, { mainTabId: null, subTabId: 3 });
  assert.equal((await fixture.send({ type: "two-tab-clear", role: "other" })).ok, false);
});

test("simultaneous registration and closure do not overwrite another role", async () => {
  const fixture = backgroundFixture({ targets: null });
  const main = fixture.send({ type: "two-tab-register", role: "main" }, { tab: { id: 1 } });
  const sub = fixture.send({ type: "two-tab-register", role: "sub" }, { tab: { id: 2 } });
  assert.equal((await main).ok, true);
  assert.equal((await sub).ok, true);
  fixture.close(1);
  await until(() => fixture.sessionStore.twoTabTargets.mainTabId === null);
  assert.deepEqual(fixture.sessionStore.twoTabTargets, { mainTabId: null, subTabId: 2 });
});

test("closure while registration is awaiting page verification clears the eventual registration", async () => {
  const fixture = backgroundFixture({ targets: null });
  let releasePing;
  const delayedPing = new Promise((resolve) => { releasePing = resolve; });
  fixture.pingHooks.set(1, () => delayedPing);
  const registration = fixture.send({ type: "two-tab-register", role: "main" }, { tab: { id: 1 } });
  await until(() => fixture.pings.length === 1);
  fixture.close(1);
  releasePing();
  await registration;
  await fixture.context.getTwoTabTargets();
  assert.deepEqual(fixture.sessionStore.twoTabTargets, { mainTabId: null, subTabId: null });
});

test("R can run from an unrelated page and monitoring OFF blocks keyboard actions", async () => {
  const fixture = backgroundFixture();
  const message = { type: "open-configured-url", trigger: { type: "key", ...RUN_KEY } };
  const running = fixture.send(message, { tab: { id: 3 } });
  await until(() => fixture.updates.length === 1);
  await fixture.finishDelay();
  assert.equal((await running).ok, true);
  await fixture.sync.set({ isEnabled: false });
  assert.equal((await fixture.send(message, { tab: { id: 3 } })).ok, true);
  assert.equal(fixture.updates.length, 2);
  assert.equal((await fixture.send({ ...message, trigger: { ...message.trigger, code: "F1" } }, { tab: { id: 3 } })).ok, true);
  assert.deepEqual(fixture.sessionStore.twoTabTargets, { mainTabId: 1, subTabId: 2 });
});

test("Ctrl+F1 can run the sequence while plain F1 remains a registration key", async () => {
  const triggerKey = { ...RUN_KEY, code: "F1", key: "F1", ctrlKey: true, displayName: "Ctrl + F1" };
  const fixture = backgroundFixture({ config: { ...CONFIG, triggerKey } });
  const running = fixture.send({ type: "open-configured-url", trigger: { type: "key", ...triggerKey } }, { tab: { id: 3 } });
  await until(() => fixture.updates.length === 1);
  assert.deepEqual(fixture.sessionStore.twoTabTargets, { mainTabId: 1, subTabId: 2 });
  await fixture.finishDelay();
  assert.equal((await running).ok, true);
  assert.equal((await fixture.send({ type: "two-tab-status" })).configured, true);
  assert.equal((await fixture.send({ type: "open-configured-url", trigger: { ...triggerKey, type: "key", ctrlKey: false } }, { tab: { id: 3 } })).ok, true);
  assert.deepEqual(fixture.sessionStore.twoTabTargets, { mainTabId: 3, subTabId: 2 });
});

for (const [name, change] of [
  ["feature is disabled", (fixture) => fixture.sync.set({ twoTabSettings: { ...CONFIG, enabled: false } })],
  ["delay is edited", (fixture) => fixture.sync.set({ twoTabSettings: { ...CONFIG, delayMs: 400 } })],
  ["main registration is cleared", (fixture) => fixture.send({ type: "two-tab-clear", role: "main" })],
  ["main tab closes", (fixture) => fixture.close(1)],
  ["sub tab closes", (fixture) => fixture.close(2)],
  ["main page loses its content script", (fixture) => { fixture.tabs.get(1).eligible = false; }],
  ["monitoring is disabled", (fixture) => fixture.sync.set({ isEnabled: false })]
]) {
  test(`keyboard run stops before main navigation when ${name} during the delay`, async () => {
    const fixture = backgroundFixture();
    const running = fixture.send({ type: "open-configured-url", trigger: { type: "key", ...RUN_KEY } });
    await until(() => fixture.updates.length === 1);
    await change(fixture);
    await fixture.finishDelay();
    assert.equal((await running).ok, false);
    assert.deepEqual(fixture.updates, [{ id: 2, url: CONFIG.subUrl }]);
    assert.equal((await fixture.send({ type: "two-tab-status" })).running, false);
  });
}

test("changing monitoring during a manual run is allowed", async () => {
  const fixture = backgroundFixture();
  const running = fixture.send({ type: "two-tab-run" });
  await until(() => fixture.updates.length === 1);
  await fixture.sync.set({ isEnabled: false });
  await fixture.finishDelay();
  assert.equal((await running).ok, true);
  assert.equal(fixture.updates.length, 2);
});

test("a settings edit followed by restoring the original values still cancels the pending run", async () => {
  const fixture = backgroundFixture();
  const running = fixture.send({ type: "two-tab-run" });
  await until(() => fixture.updates.length === 1);
  await fixture.sync.set({ twoTabSettings: { ...CONFIG, delayMs: 100 } });
  await fixture.sync.set({ twoTabSettings: CONFIG });
  await fixture.finishDelay();
  assert.equal((await running).ok, false);
  assert.equal(fixture.updates.length, 1);
});

test("status distinguishes configuration, live registration and corrupt duplicate targets", async () => {
  const fixture = backgroundFixture({ targets: { mainTabId: 1, subTabId: 1 } });
  assert.deepEqual(await fixture.send({ type: "two-tab-status" }), {
    ok: true, enabled: true, configured: true, running: false, mainRegistered: true, subRegistered: false
  });
  fixture.close(1);
  await until(() => fixture.sessionStore.twoTabTargets.mainTabId === null);
  assert.deepEqual(fixture.sessionStore.twoTabTargets, { mainTabId: null, subTabId: null });
  const status = await fixture.send({ type: "two-tab-status" });
  assert.equal(status.mainRegistered, false);
  assert.equal(status.subRegistered, false);
});

test("disabled two-tab feature leaves ordinary key and mouse rules working", async () => {
  const fixture = backgroundFixture({
    config: { ...CONFIG, enabled: false },
    rules: [
      { id: "r", enabled: true, triggerType: "key", triggerKey: RUN_KEY, targetUrl: "https://ordinary.example/" },
      { id: "mouse", enabled: true, triggerType: "mouse", mouseButton: "side", targetUrl: "https://mouse.example/" }
    ]
  });
  assert.equal((await fixture.send({ type: "open-configured-url", trigger: { type: "key", ...RUN_KEY } })).ok, true);
  assert.equal((await fixture.send({ type: "open-configured-url", trigger: { type: "mouse", button: 3 } })).ok, true);
  assert.deepEqual(fixture.updates, [{ id: 3, url: "https://ordinary.example/" }, { id: 3, url: "https://mouse.example/" }]);
});

function contentFixture({ twoTabSettings = CONFIG, isEnabled = true, rules = [] } = {}) {
  const sent = [];
  const messages = eventChannel();
  class Element {
    constructor(editable = false) { this.editable = editable; }
    closest() { return this.editable ? this : null; }
    getAttribute() { return null; }
  }
  let now = 1000;
  const context = vm.createContext({
    URL, Element, console,
    Date: { now: () => now },
    document: { addEventListener() {} },
    window: { addEventListener() {}, location: { protocol: "https:" } },
    chrome: {
      runtime: { onMessage: messages, sendMessage(message, callback) { sent.push(plain(message)); callback?.(); } },
      storage: { onChanged: eventChannel(), sync: { async get(defaults) { return { ...defaults, isEnabled, rules, twoTabSettings }; } } }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "content.js"), "utf8"), context);
  return {
    context, sent, messages,
    press(code, overrides = {}) {
      now += 400;
      const event = {
        ...RUN_KEY, code, key: code, target: new Element(), isTrusted: true, repeat: false, cancelable: true,
        preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...overrides
      };
      context.handleKeyboardEvent(event);
    },
    editable: () => new Element(true)
  };
}

test("content forwards one trusted F1/F2/run key press, ignores holds, editable inputs, modifiers and synthetic keys", async () => {
  const fixture = contentFixture();
  await fixture.context.loadSettings();
  fixture.press("F1");
  fixture.press("F2");
  fixture.press("KeyR");
  fixture.press("KeyR", { repeat: true });
  fixture.press("F1", { repeat: true });
  fixture.press("F2", { repeat: true });
  fixture.press("KeyR", { isTrusted: false });
  fixture.press("KeyR", { target: fixture.editable() });
  fixture.press("F1", { ctrlKey: true });
  assert.deepEqual(fixture.sent.map((message) => message.trigger.code), ["F1", "F2", "KeyR"]);
});

test("content honors a custom run key, an invalid stored key and monitoring OFF", async () => {
  const custom = contentFixture({ twoTabSettings: { ...CONFIG, triggerKey: { ...RUN_KEY, code: "KeyG", ctrlKey: true } } });
  await custom.context.loadSettings();
  custom.press("KeyR");
  custom.press("KeyG");
  custom.press("KeyG", { ctrlKey: true });
  assert.deepEqual(custom.sent.map((message) => message.trigger.code), ["KeyG"]);
  const modifiedFunctionKey = contentFixture({ twoTabSettings: { ...CONFIG, triggerKey: { ...RUN_KEY, code: "F1", key: "F1", ctrlKey: true } } });
  await modifiedFunctionKey.context.loadSettings();
  modifiedFunctionKey.press("F1", { ctrlKey: true });
  assert.deepEqual(modifiedFunctionKey.sent.map((message) => message.trigger.code), ["F1"]);
  const invalid = contentFixture({ twoTabSettings: { ...CONFIG, triggerKey: null } });
  await invalid.context.loadSettings();
  invalid.press("KeyR");
  assert.equal(invalid.sent.length, 0);
  const disabled = contentFixture({ isEnabled: false });
  await disabled.context.loadSettings();
  disabled.press("F1");
  disabled.press("KeyR");
  assert.equal(disabled.sent.length, 0);
});

test("content eligibility ping accepts only HTTP/S pages", () => {
  const fixture = contentFixture();
  for (const [protocol, expected] of [["https:", true], ["http:", true], ["chrome:", false], ["file:", false]]) {
    fixture.context.window.location.protocol = protocol;
    let response;
    fixture.messages.listeners[0]({ type: "two-tab-ping" }, {}, (value) => { response = plain(value); });
    assert.deepEqual(response, { eligible: expected });
  }
});
