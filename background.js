const DEFAULT_URL = "https://chatgpt.com/";

const STORAGE_KEYS = {
  targetUrl: "targetUrl",
  isEnabled: "isEnabled",
  triggerType: "triggerType",
  triggerKey: "triggerKey",
  rules: "rules"
};

const MESSAGE_TYPES = {
  openFromTrigger: "open-configured-url",
  openNow: "open-configured-url-now"
};

const DEFAULT_TRIGGER_TYPE = "mouse";
const DEFAULT_MOUSE_BUTTON = "side";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === MESSAGE_TYPES.openFromTrigger) {
    openFromTrigger(message.trigger)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("[Quick Side Nav] Failed to open URL:", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === MESSAGE_TYPES.openNow) {
    openRuleById(message.ruleId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("[Quick Side Nav] Failed to open URL:", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  return false;
});

async function openFromTrigger(trigger) {
  const settings = await getSettings();

  if (!settings.isEnabled) {
    return;
  }

  const rule = settings.rules.find((candidate) => doesRuleMatchTrigger(candidate, trigger));

  if (!rule) {
    return;
  }

  await openUrlInCurrentTab(rule.targetUrl);
}

async function openRuleById(ruleId) {
  const settings = await getSettings();
  const rule = settings.rules.find((candidate) => candidate.id === ruleId) || settings.rules[0];

  if (!rule) {
    throw new Error("No route rule found.");
  }

  await openUrlInCurrentTab(rule.targetUrl);
}

async function getSettings() {
  const result = await chrome.storage.sync.get({
    [STORAGE_KEYS.isEnabled]: false,
    [STORAGE_KEYS.rules]: null,
    [STORAGE_KEYS.targetUrl]: DEFAULT_URL,
    [STORAGE_KEYS.triggerType]: DEFAULT_TRIGGER_TYPE,
    [STORAGE_KEYS.triggerKey]: null
  });

  return {
    isEnabled: Boolean(result[STORAGE_KEYS.isEnabled]),
    rules: getRulesFromStorage(result)
  };
}

function getRulesFromStorage(result) {
  if (Array.isArray(result[STORAGE_KEYS.rules])) {
    const rules = result[STORAGE_KEYS.rules]
      .map(normalizeRule)
      .filter(Boolean);

    if (rules.length > 0) {
      return rules;
    }
  }

  return [createLegacyRule(result)];
}

function createLegacyRule(result) {
  const targetUrl = normalizeUrl(result[STORAGE_KEYS.targetUrl]);
  const triggerType = normalizeTriggerType(result[STORAGE_KEYS.triggerType]);

  return normalizeRule({
    id: "legacy-default-rule",
    targetUrl: isValidUrl(targetUrl) ? targetUrl : DEFAULT_URL,
    triggerType,
    mouseButton: DEFAULT_MOUSE_BUTTON,
    triggerKey: normalizeTriggerKey(result[STORAGE_KEYS.triggerKey])
  }) || createDefaultRule();
}

function createDefaultRule() {
  return {
    id: "default-side-button-rule",
    targetUrl: DEFAULT_URL,
    triggerType: "mouse",
    mouseButton: DEFAULT_MOUSE_BUTTON,
    triggerKey: null
  };
}

async function openUrlInCurrentTab(url) {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  if (!tab || typeof tab.id !== "number") {
    throw new Error("No active tab found.");
  }

  await chrome.tabs.update(tab.id, { url });
}

function doesRuleMatchTrigger(rule, trigger) {
  if (!trigger || rule.triggerType !== trigger.type) {
    return false;
  }

  if (rule.triggerType === "mouse") {
    return doesMouseButtonMatch(rule.mouseButton, trigger.button);
  }

  if (rule.triggerType === "key") {
    return doesKeyMatch(rule.triggerKey, trigger);
  }

  return false;
}

function doesMouseButtonMatch(mouseButton, button) {
  if (typeof button !== "number") {
    return false;
  }

  if (mouseButton === "side") {
    return button === 3 || button === 4;
  }

  return Number(mouseButton) === button;
}

function doesKeyMatch(triggerKey, trigger) {
  if (!triggerKey || typeof trigger.code !== "string") {
    return false;
  }

  return trigger.code === triggerKey.code
    && Boolean(trigger.ctrlKey) === triggerKey.ctrlKey
    && Boolean(trigger.altKey) === triggerKey.altKey
    && Boolean(trigger.shiftKey) === triggerKey.shiftKey
    && Boolean(trigger.metaKey) === triggerKey.metaKey;
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== "object") {
    return null;
  }

  const targetUrl = normalizeUrl(rule.targetUrl);

  if (!isValidUrl(targetUrl)) {
    return null;
  }

  const triggerType = normalizeTriggerType(rule.triggerType);
  const triggerKey = normalizeTriggerKey(rule.triggerKey);

  if (triggerType === "key" && !triggerKey) {
    return null;
  }

  return {
    id: typeof rule.id === "string" && rule.id ? rule.id : createRuleId(),
    targetUrl,
    triggerType,
    mouseButton: normalizeMouseButton(rule.mouseButton),
    triggerKey
  };
}

function normalizeUrl(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
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
    key: typeof value.key === "string" ? value.key : value.code,
    ctrlKey: Boolean(value.ctrlKey),
    altKey: Boolean(value.altKey),
    shiftKey: Boolean(value.shiftKey),
    metaKey: Boolean(value.metaKey),
    displayName: typeof value.displayName === "string" ? value.displayName : value.code
  };
}

function createRuleId() {
  return `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
