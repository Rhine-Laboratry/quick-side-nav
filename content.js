const SIDE_BUTTONS = new Set([3, 4]);
const COOLDOWN_MS = 300;
const MESSAGE_TYPE = "open-configured-url";
const DEFAULT_TRIGGER_TYPE = "mouse";
const LISTENER_OPTIONS = {
  capture: true,
  passive: false
};

let lastTriggeredAt = 0;
let settings = {
  isEnabled: false,
  triggerType: DEFAULT_TRIGGER_TYPE,
  triggerKey: null
};

for (const eventName of ["mousedown", "mouseup", "auxclick"]) {
  window.addEventListener(eventName, handleMouseEvent, LISTENER_OPTIONS);
  document.addEventListener(eventName, handleMouseEvent, LISTENER_OPTIONS);
}

for (const eventName of ["keydown"]) {
  window.addEventListener(eventName, handleKeyboardEvent, LISTENER_OPTIONS);
  document.addEventListener(eventName, handleKeyboardEvent, LISTENER_OPTIONS);
}

loadSettings();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }

  settings = {
    ...settings,
    isEnabled: getChangedValue(changes.isEnabled, settings.isEnabled),
    triggerType: normalizeTriggerType(getChangedValue(changes.triggerType, settings.triggerType)),
    triggerKey: normalizeTriggerKey(getChangedValue(changes.triggerKey, settings.triggerKey))
  };
});

function handleMouseEvent(event) {
  if (!event.isTrusted || !SIDE_BUTTONS.has(event.button)) {
    return;
  }

  if (!settings.isEnabled || settings.triggerType !== "mouse") {
    return;
  }

  suppressEvent(event);
  triggerNavigation("mouse");
}

function handleKeyboardEvent(event) {
  if (!event.isTrusted || !matchesTriggerKey(event)) {
    return;
  }

  suppressEvent(event);
  triggerNavigation("key");
}

function triggerNavigation(triggerType) {
  const now = Date.now();
  if (now - lastTriggeredAt < COOLDOWN_MS) {
    return;
  }

  lastTriggeredAt = now;
  chrome.runtime.sendMessage({ type: MESSAGE_TYPE, triggerType }, () => {
    chrome.runtime.lastError;
  });
}

async function loadSettings() {
  const result = await chrome.storage.sync.get({
    isEnabled: false,
    triggerType: DEFAULT_TRIGGER_TYPE,
    triggerKey: null
  });

  settings = {
    isEnabled: Boolean(result.isEnabled),
    triggerType: normalizeTriggerType(result.triggerType),
    triggerKey: normalizeTriggerKey(result.triggerKey)
  };
}

function matchesTriggerKey(event) {
  const triggerKey = settings.triggerKey;

  if (!settings.isEnabled || settings.triggerType !== "key" || !triggerKey) {
    return false;
  }

  if (isEditableTarget(event.target)) {
    return false;
  }

  return event.code === triggerKey.code
    && event.ctrlKey === triggerKey.ctrlKey
    && event.altKey === triggerKey.altKey
    && event.shiftKey === triggerKey.shiftKey
    && event.metaKey === triggerKey.metaKey;
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  const editable = target.closest("input, textarea, select, [contenteditable]");

  if (!editable) {
    return false;
  }

  return editable.getAttribute("contenteditable") !== "false";
}

function suppressEvent(event) {
  if (event.cancelable) {
    event.preventDefault();
  }

  event.stopPropagation();

  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
}

function getChangedValue(change, fallback) {
  return change ? change.newValue : fallback;
}

function normalizeTriggerType(value) {
  return value === "key" ? "key" : DEFAULT_TRIGGER_TYPE;
}

function normalizeTriggerKey(value) {
  if (!value || typeof value !== "object" || typeof value.code !== "string") {
    return null;
  }

  return {
    code: value.code,
    key: typeof value.key === "string" ? value.key : value.code,
    ctrlKey: Boolean(value.ctrlKey),
    altKey: Boolean(value.altKey),
    shiftKey: Boolean(value.shiftKey),
    metaKey: Boolean(value.metaKey),
    displayName: typeof value.displayName === "string" ? value.displayName : value.code
  };
}
