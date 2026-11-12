const SIDE_BUTTONS = new Set([3, 4]);
const COOLDOWN_MS = 300;
const MESSAGE_TYPE = "open-configured-url";
const DEFAULT_TRIGGER_TYPE = "mouse";
const DEFAULT_MOUSE_BUTTON = "side";
const MAX_URL_LENGTH = 2048;
const DEFAULT_TWO_TAB_KEY = {
  code: "KeyR", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false
};
const LISTENER_OPTIONS = {
  capture: true,
  passive: false
};

let lastTriggeredAt = 0;
let settings = {
  isEnabled: false,
  rules: [],
  twoTabSettings: { enabled: false, triggerKey: DEFAULT_TWO_TAB_KEY }
};

for (const eventName of ["mousedown", "mouseup", "auxclick"]) {
  window.addEventListener(eventName, handleMouseEvent, LISTENER_OPTIONS);
  document.addEventListener(eventName, handleMouseEvent, LISTENER_OPTIONS);
}

window.addEventListener("keydown", handleKeyboardEvent, LISTENER_OPTIONS);
document.addEventListener("keydown", handleKeyboardEvent, LISTENER_OPTIONS);

loadSettings();

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === "sync") {
    loadSettings();
  }
});

chrome.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
  if (message?.type === "two-tab-ping") {
    sendResponse({ eligible: window.location.protocol === "http:" || window.location.protocol === "https:" });
  }
});

function handleMouseEvent(event) {
  if (!event.isTrusted || !SIDE_BUTTONS.has(event.button)) {
    return;
  }

  if (!settings.isEnabled || !hasMatchingMouseRule(event.button)) {
    return;
  }

  suppressEvent(event);

  if (event.type !== "mousedown") {
    return;
  }

  triggerNavigation({
    type: "mouse",
    button: event.button
  });
}

function handleKeyboardEvent(event) {
  if (!event.isTrusted || isEditableTarget(event.target) || !hasMatchingKeyRule(event)) {
    return;
  }

  suppressEvent(event);

  if (event.repeat) {
    return;
  }

  triggerNavigation({
    type: "key",
    code: event.code,
    key: event.key,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey
  });
}

function triggerNavigation(trigger) {
  const now = Date.now();
  if (now - lastTriggeredAt < COOLDOWN_MS) {
    return;
  }

  lastTriggeredAt = now;
  chrome.runtime.sendMessage({ type: MESSAGE_TYPE, trigger }, () => {
    chrome.runtime.lastError;
  });
}

async function loadSettings() {
  const result = await chrome.storage.sync.get({
    isEnabled: false,
    rules: null,
    targetUrl: "https://example.com/",
    triggerType: DEFAULT_TRIGGER_TYPE,
    triggerKey: null,
    twoTabSettings: null
  });

  settings = {
    isEnabled: Boolean(result.isEnabled),
    rules: getRulesFromStorage(result),
    twoTabSettings: {
      enabled: result.twoTabSettings?.enabled === true,
      triggerKey: normalizeTwoTabTriggerKey(result.twoTabSettings?.triggerKey)
    }
  };
}

function getRulesFromStorage(result) {
  if (Array.isArray(result.rules)) {
    return result.rules.map(normalizeRule).filter(Boolean);
  }

  const legacyRule = normalizeRule({
    id: "legacy-default-rule",
    targetUrl: result.targetUrl,
    triggerType: result.triggerType,
    mouseButton: DEFAULT_MOUSE_BUTTON,
    triggerKey: result.triggerKey,
    enabled: true
  });

  return legacyRule ? [legacyRule] : [];
}

function hasMatchingMouseRule(button) {
  return settings.rules.some((rule) => {
    if (!isRuleEnabled(rule) || rule.triggerType !== "mouse") {
      return false;
    }

    if (rule.mouseButton === "side") {
      return button === 3 || button === 4;
    }

    return Number(rule.mouseButton) === button;
  });
}

function hasMatchingKeyRule(event) {
  if (!settings.isEnabled) {
    return false;
  }

  if (settings.twoTabSettings.enabled) {
    const plainFunctionKey = (event.code === "F1" || event.code === "F2")
      && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
    if (plainFunctionKey || doesKeyMatch(settings.twoTabSettings.triggerKey, event)) {
      return true;
    }
  }

  return settings.rules.some((rule) => {
    if (!isRuleEnabled(rule) || rule.triggerType !== "key" || !rule.triggerKey) {
      return false;
    }

    return doesKeyMatch(rule.triggerKey, event);
  });
}

function doesKeyMatch(triggerKey, event) {
  return Boolean(triggerKey) && event.code === triggerKey.code
    && event.ctrlKey === triggerKey.ctrlKey
    && event.altKey === triggerKey.altKey
    && event.shiftKey === triggerKey.shiftKey
    && event.metaKey === triggerKey.metaKey;
}

function normalizeTwoTabTriggerKey(value) {
  if (value === undefined) {
    return DEFAULT_TWO_TAB_KEY;
  }
  const key = normalizeTriggerKey(value);
  const registrationKey = key && (key.code === "F1" || key.code === "F2")
    && !key.ctrlKey && !key.altKey && !key.shiftKey && !key.metaKey;
  const keyValue = typeof value?.key === "string" ? value.key : key?.code;
  if (!key || !key.code.trim() || registrationKey
    || /^(Control|Alt|Shift|Meta)(Left|Right)?$/.test(key.code)
    || ["Control", "Alt", "Shift", "Meta", "Unidentified"].includes(keyValue)) {
    return null;
  }
  return key;
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

function normalizeRule(rule) {
  if (!rule || typeof rule !== "object") {
    return null;
  }

  if (!normalizeValidUrl(rule.targetUrl)) {
    return null;
  }

  const triggerType = normalizeTriggerType(rule.triggerType);
  const triggerKey = normalizeTriggerKey(rule.triggerKey);

  if (triggerType === "key" && !triggerKey) {
    return null;
  }

  return {
    enabled: isRuleEnabled(rule),
    triggerType,
    mouseButton: normalizeMouseButton(rule.mouseButton),
    triggerKey
  };
}

function isRuleEnabled(rule) {
  return rule?.enabled !== false;
}

function normalizeUrl(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeValidUrl(value) {
  const targetUrl = normalizeUrl(value);

  if (!targetUrl || targetUrl.length > MAX_URL_LENGTH || !/^https?:\/\//i.test(targetUrl)) {
    return "";
  }

  try {
    const url = new URL(targetUrl);

    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return "";
    }

    const normalizedUrl = url.href;
    return normalizedUrl.length <= MAX_URL_LENGTH ? normalizedUrl : "";
  } catch {
    return "";
  }
}

function normalizeTriggerType(value) {
  return value === "key" ? "key" : DEFAULT_TRIGGER_TYPE;
}

function normalizeMouseButton(value) {
  return value === "3" || value === "4" ? value : DEFAULT_MOUSE_BUTTON;
}

function normalizeTriggerKey(value) {
  if (!value || typeof value !== "object" || typeof value.code !== "string") {
    return null;
  }

  return {
    code: value.code,
    ctrlKey: Boolean(value.ctrlKey),
    altKey: Boolean(value.altKey),
    shiftKey: Boolean(value.shiftKey),
    metaKey: Boolean(value.metaKey)
  };
}
