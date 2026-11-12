"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const POPUP_PATH = path.join(__dirname, "..", "popup.js");

function createElement() {
  const attributes = new Map();
  const listeners = new Map();
  return {
    checked: false,
    children: [],
    className: "",
    classList: { toggle() {} },
    dataset: {},
    disabled: false,
    textContent: "",
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    async dispatch(type, event = {}) {
      await Promise.all((listeners.get(type) || []).map((listener) => listener(event)));
    },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name); }
  };
}

function readyStatus(overrides = {}) {
  return {
    ok: true,
    enabled: true,
    configured: true,
    running: false,
    mainRegistered: true,
    subRegistered: true,
    ...overrides
  };
}

function createFixture({ status = readyStatus(), sendMessage, isEnabled = false } = {}) {
  const elements = Object.fromEntries([
    "enabledToggle", "switchState", "switchHint", "rulesList", "optionsButton", "statusMessage",
    "twoTabSection", "twoTabMainState", "twoTabSubState", "twoTabRegisterMain", "twoTabRegisterSub",
    "twoTabClearMain", "twoTabClearSub", "twoTabRun"
  ].map((id) => [id, createElement()]));
  const messages = [];
  const syncWrites = [];
  let closed = 0;
  let optionsOpened = 0;
  const timers = new Map();
  let nextTimer = 0;
  const windowListeners = new Map();
  const fixture = { elements, messages, syncWrites, status, timers };
  const context = vm.createContext({
    URL,
    document: {
      addEventListener() {},
      createElement,
      getElementById(id) { return elements[id]; }
    },
    setTimeout(callback) {
      nextTimer += 1;
      timers.set(nextTimer, callback);
      return nextTimer;
    },
    clearTimeout(id) { timers.delete(id); },
    window: {
      close() { closed += 1; },
      addEventListener(type, listener) { windowListeners.set(type, listener); }
    },
    chrome: {
      runtime: {
        async sendMessage(message) {
          messages.push(JSON.parse(JSON.stringify(message)));
          if (sendMessage) return sendMessage(message, fixture);
          return message.type === "two-tab-status" ? fixture.status : { ok: true };
        },
        openOptionsPage() { optionsOpened += 1; }
      },
      storage: { sync: {
        async get(defaults) {
          return {
            ...defaults,
            isEnabled,
            rules: [{ id: "rule-1", enabled: true, targetUrl: "https://example.com/", triggerType: "mouse" }]
          };
        },
        async set(payload) { syncWrites.push(JSON.parse(JSON.stringify(payload))); }
      } }
    }
  });
  vm.runInContext(fs.readFileSync(POPUP_PATH, "utf8"), context, { filename: POPUP_PATH });
  fixture.context = context;
  fixture.closed = () => closed;
  fixture.optionsOpened = () => optionsOpened;
  fixture.unload = () => windowListeners.get("unload")();
  fixture.tick = async () => {
    const scheduled = [...timers.entries()];
    for (const [id, callback] of scheduled) {
      timers.delete(id);
      await callback();
    }
  };
  return fixture;
}

test("register and clear actions target the requested role and refresh their state", async () => {
  const fixture = createFixture({
    status: readyStatus({ mainRegistered: false, subRegistered: false }),
    sendMessage(message, state) {
      if (message.type === "two-tab-register") state.status[`${message.role}Registered`] = true;
      if (message.type === "two-tab-clear") state.status[`${message.role}Registered`] = false;
      return message.type === "two-tab-status" ? state.status : { ok: true };
    }
  });
  await fixture.context.initPopup();

  assert.equal(fixture.elements.twoTabMainState.textContent, "未登録");
  assert.equal(fixture.elements.twoTabClearMain.disabled, true);
  await fixture.elements.twoTabRegisterMain.dispatch("click");
  assert.deepEqual(fixture.messages.slice(-2), [
    { type: "two-tab-register", role: "main" }, { type: "two-tab-status" }
  ]);
  assert.equal(fixture.elements.twoTabMainState.textContent, "登録済み");
  assert.equal(fixture.elements.twoTabSubState.textContent, "未登録");
  assert.equal(fixture.elements.twoTabClearMain.disabled, false);

  await fixture.elements.twoTabRegisterSub.dispatch("click");
  assert.equal(fixture.elements.twoTabRun.disabled, false);
  await fixture.elements.twoTabClearSub.dispatch("click");
  assert.deepEqual(fixture.messages.slice(-2), [
    { type: "two-tab-clear", role: "sub" }, { type: "two-tab-status" }
  ]);
  assert.equal(fixture.elements.twoTabSubState.textContent, "未登録");
  assert.equal(fixture.elements.twoTabRun.disabled, true);
  assert.equal(fixture.closed(), 0);
});

test("manual run is available with input monitoring off and does not close the popup", async () => {
  const fixture = createFixture({ isEnabled: false });
  await fixture.context.initPopup();
  assert.equal(fixture.elements.enabledToggle.checked, false);
  assert.equal(fixture.elements.twoTabRun.disabled, false);

  await fixture.elements.twoTabRun.dispatch("click");

  assert.deepEqual(fixture.messages.slice(-2), [{ type: "two-tab-run" }, { type: "two-tab-status" }]);
  assert.equal(fixture.elements.statusMessage.textContent, "連携を実行しました。");
  assert.equal(fixture.elements.statusMessage.className, "status success");
  assert.equal(fixture.closed(), 0);
});

test("manual run stays disabled until enabled, configured, and both tabs registered", async () => {
  for (const overrides of [
    { enabled: false }, { configured: false }, { mainRegistered: false },
    { subRegistered: false }, { running: true }
  ]) {
    const fixture = createFixture({ status: readyStatus(overrides) });
    await fixture.context.initPopup();
    assert.equal(fixture.elements.twoTabRun.disabled, true, JSON.stringify(overrides));
    if (overrides.running) {
      assert.equal(fixture.elements.twoTabRegisterMain.disabled, true);
      assert.equal(fixture.elements.twoTabClearSub.disabled, true);
    }
  }
});

test("pending actions disable all sequence controls, ignore overlap, and restore after failure", async () => {
  let resolveAction;
  const fixture = createFixture({
    sendMessage(message, state) {
      if (message.type === "two-tab-status") return state.status;
      return new Promise((resolve) => { resolveAction = resolve; });
    }
  });
  await fixture.context.initPopup();
  const action = fixture.elements.twoTabRun.dispatch("click");
  for (const id of ["twoTabRegisterMain", "twoTabRegisterSub", "twoTabClearMain", "twoTabClearSub", "twoTabRun"]) {
    assert.equal(fixture.elements[id].disabled, true, `${id} must be disabled`);
  }
  assert.equal(fixture.elements.twoTabSection.getAttribute("aria-busy"), "true");
  await fixture.elements.twoTabRegisterMain.dispatch("click");
  assert.equal(fixture.messages.filter((message) => message.type !== "two-tab-status").length, 1);

  resolveAction({ ok: false, error: "Registered sub tab no longer exists." });
  await action;

  assert.equal(fixture.elements.statusMessage.textContent, "Registered sub tab no longer exists.");
  assert.equal(fixture.elements.twoTabRun.disabled, false);
  assert.equal(fixture.elements.twoTabRegisterMain.disabled, false);
  assert.equal(fixture.elements.twoTabClearSub.disabled, false);
  assert.equal(fixture.elements.twoTabSection.getAttribute("aria-busy"), "false");
});

test("status-load failure leaves saved rules, monitoring, settings, and registration usable", async () => {
  const fixture = createFixture({ sendMessage() { throw new Error("Status temporarily unavailable"); } });
  await fixture.context.initPopup();

  assert.equal(fixture.elements.rulesList.children.length, 1);
  assert.equal(fixture.elements.statusMessage.textContent, "Status temporarily unavailable");
  assert.equal(fixture.elements.twoTabRun.disabled, true);
  assert.equal(fixture.elements.twoTabRegisterMain.disabled, false);
  assert.equal(fixture.elements.twoTabMainState.textContent, "—");
  fixture.elements.enabledToggle.checked = true;
  await fixture.elements.enabledToggle.dispatch("change");
  assert.deepEqual(fixture.syncWrites, [{ isEnabled: true }]);
  assert.equal(fixture.elements.switchState.textContent, "ON");
  await fixture.elements.optionsButton.dispatch("click");
  assert.equal(fixture.optionsOpened(), 1);
});

test("registration errors remain visible when the following status refresh also fails", async () => {
  let failStatus = false;
  const fixture = createFixture({
    sendMessage(message, state) {
      if (message.type === "two-tab-status") {
        if (failStatus) throw new Error("Status unavailable");
        return state.status;
      }
      failStatus = true;
      return { ok: false, error: "Only regular HTTP/HTTPS tabs can be registered." };
    }
  });
  await fixture.context.initPopup();
  await fixture.elements.twoTabRegisterSub.dispatch("click");
  assert.equal(fixture.elements.statusMessage.textContent, "Only regular HTTP/HTTPS tabs can be registered.");
  assert.equal(fixture.elements.twoTabRegisterSub.disabled, false);
  assert.equal(fixture.elements.twoTabRun.disabled, true);
});

test("saved-rule actions continue to use their original message and close after success", async () => {
  const fixture = createFixture();
  await fixture.context.initPopup();
  const button = createElement();
  button.dataset.ruleId = "rule-1";
  await fixture.elements.rulesList.dispatch("click", { target: button });
  assert.deepEqual(fixture.messages.at(-1), { type: "open-configured-url-now", ruleId: "rule-1" });
  assert.equal(fixture.closed(), 1);
});

test("an externally running sequence refreshes until it finishes, then enables actions", async () => {
  const fixture = createFixture({ status: readyStatus({ running: true }) });
  await fixture.context.initPopup();
  assert.equal(fixture.timers.size, 1);
  assert.equal(fixture.elements.twoTabRun.disabled, true);
  fixture.status = readyStatus({ running: false });

  await fixture.tick();

  assert.equal(fixture.elements.twoTabRun.disabled, false);
  assert.equal(fixture.timers.size, 0);
});

test("polling stops on a failed refresh and on popup unload", async () => {
  const fixture = createFixture({
    status: readyStatus({ running: true }),
    sendMessage(message, state) {
      if (!state.status) throw new Error("Status disconnected");
      return state.status;
    }
  });
  await fixture.context.initPopup();
  fixture.status = null;
  await fixture.tick();
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.elements.twoTabRegisterMain.disabled, false);

  fixture.status = readyStatus({ running: true });
  await fixture.context.refreshTwoTabStatus();
  assert.equal(fixture.timers.size, 1);
  fixture.unload();
  assert.equal(fixture.timers.size, 0);
});

test("overlapping status reads share a single request", async () => {
  let resolveStatus;
  const fixture = createFixture({
    sendMessage() { return new Promise((resolve) => { resolveStatus = resolve; }); }
  });
  const initialRead = fixture.context.refreshTwoTabStatus();
  const overlappingRead = fixture.context.refreshTwoTabStatus();
  assert.equal(fixture.messages.length, 1);
  resolveStatus(readyStatus());
  await Promise.all([initialRead, overlappingRead]);
  assert.equal(fixture.elements.twoTabRun.disabled, false);
});
