const DEFAULT_URL = "https://example.com/";

const STORAGE_KEYS = {
  targetUrl: "targetUrl",
  isEnabled: "isEnabled",
  triggerType: "triggerType",
  triggerKey: "triggerKey",
  rules: "rules",
  urlPresets: "urlPresets"
};

const MESSAGE_TYPES = {
  openFromTrigger: "open-configured-url",
  openNow: "open-configured-url-now"
};

const DEFAULT_TRIGGER_TYPE = "mouse";
const DEFAULT_MOUSE_BUTTON = "side";
const ENABLED_BADGE_COLOR = "#047857";
const ADDED_BADGE_COLOR = "#2563eb";
const ERROR_BADGE_COLOR = "#b91c1c";
const MAX_URL_LENGTH = 2048;
const MAX_PRESET_LABEL_LENGTH = 80;
const SYNC_ITEM_QUOTA_BYTES = 8192;
const CONTEXT_MENU_ADD_PRESET_ID = "quick-side-nav-add-page-preset";

chrome.runtime.onInstalled.addListener(() => {
  syncActionBadge();
});

chrome.runtime.onStartup.addListener(() => {
  syncActionBadge();
});

if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ADD_PRESET_ID) {
      return;
    }

    addCurrentPageUrlPreset(info, tab)
      .then((result) => flashActionBadge(result.added ? "ADD" : "OK", ADDED_BADGE_COLOR))
      .catch((error) => {
        console.warn("[Quick Side Nav] Failed to add URL preset from context menu:", error);
        flashActionBadge("!", ERROR_BADGE_COLOR);
      });
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && STORAGE_KEYS.isEnabled in changes) {
    syncActionBadge();
  }
});

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

setupContextMenus();
syncActionBadge();

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
  const enabledRules = settings.rules.filter(isRuleEnabled);
  const rule = enabledRules.find((candidate) => candidate.id === ruleId) || enabledRules[0];

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
    return result[STORAGE_KEYS.rules]
      .map(normalizeRule)
      .filter(Boolean);
  }

  const legacyRule = createLegacyRule(result);
  return legacyRule ? [legacyRule] : [];
}

function createLegacyRule(result) {
  const targetUrl = normalizeUrl(result[STORAGE_KEYS.targetUrl]);
  const triggerType = normalizeTriggerType(result[STORAGE_KEYS.triggerType]);

  return normalizeRule({
    id: "legacy-default-rule",
    targetUrl,
    triggerType,
    mouseButton: DEFAULT_MOUSE_BUTTON,
    triggerKey: normalizeTriggerKey(result[STORAGE_KEYS.triggerKey]),
    enabled: true
  });
}

function setupContextMenus() {
  if (!chrome.contextMenus?.create) {
    return;
  }

  chrome.contextMenus.removeAll(() => {
    const removeError = chrome.runtime.lastError;

    if (removeError) {
      console.warn("[Quick Side Nav] Failed to reset context menus:", removeError);
    }

    chrome.contextMenus.create({
      id: CONTEXT_MENU_ADD_PRESET_ID,
      title: getLocalizedMessage("contextAddPagePreset", "Add this page to URL presets"),
      contexts: ["page"],
      documentUrlPatterns: ["http://*/*", "https://*/*"]
    }, () => {
      const createError = chrome.runtime.lastError;

      if (createError) {
        console.warn("[Quick Side Nav] Failed to create context menu:", createError);
      }
    });
  });
}

async function addCurrentPageUrlPreset(info, tab) {
  const targetUrl = normalizeValidUrl(info.pageUrl || tab?.url);

  if (!targetUrl) {
    throw new Error("No valid page URL found.");
  }

  const result = await chrome.storage.sync.get({
    [STORAGE_KEYS.urlPresets]: null
  });
  const presets = getUrlPresetsFromStorage(result);
  const existingPreset = presets.find((preset) => normalizeValidUrl(preset.targetUrl) === targetUrl);

  if (existingPreset) {
    return { added: false, preset: existingPreset };
  }

  const nextPresets = [
    ...presets,
    {
      id: createPresetId(),
      label: getPresetLabel(tab?.title, targetUrl),
      targetUrl
    }
  ];

  const storageSizeError = getStorageSizeError(STORAGE_KEYS.urlPresets, nextPresets);

  if (storageSizeError) {
    throw new Error(storageSizeError);
  }

  await chrome.storage.sync.set({
    [STORAGE_KEYS.urlPresets]: nextPresets
  });

  return { added: true, preset: nextPresets[nextPresets.length - 1] };
}

function getUrlPresetsFromStorage(result) {
  if (!Array.isArray(result[STORAGE_KEYS.urlPresets])) {
    return [];
  }

  const seenIds = new Set();

  return result[STORAGE_KEYS.urlPresets]
    .map(normalizeStoredUrlPreset)
    .filter((preset) => {
      if (!preset || seenIds.has(preset.id)) {
        return false;
      }

      seenIds.add(preset.id);
      return true;
    });
}

function normalizeStoredUrlPreset(preset) {
  if (!preset || typeof preset !== "object") {
    return null;
  }

  return {
    id: typeof preset.id === "string" && preset.id ? preset.id : createPresetId(),
    label: normalizePresetLabel(preset.label, preset.targetUrl),
    targetUrl: normalizeUrl(preset.targetUrl)
  };
}

function getPresetLabel(tabTitle, targetUrl) {
  const title = typeof tabTitle === "string" ? tabTitle.trim() : "";
  return normalizePresetLabel(title, targetUrl);
}

function normalizePresetLabel(value, targetUrl) {
  const label = typeof value === "string" ? value.trim() : "";
  return (label || getDefaultPresetLabel(targetUrl)).slice(0, MAX_PRESET_LABEL_LENGTH);
}

function getDefaultPresetLabel(targetUrl) {
  try {
    const url = new URL(targetUrl);
    return url.hostname || getLocalizedMessage("defaultPresetLabel", "URL preset");
  } catch {
    return getLocalizedMessage("defaultPresetLabel", "URL preset");
  }
}

function getStorageSizeError(key, value) {
  const serialized = `${key}${JSON.stringify(value)}`;
  const byteLength = new TextEncoder().encode(serialized).byteLength;

  return byteLength > SYNC_ITEM_QUOTA_BYTES ? "Chrome sync storage item quota exceeded." : "";
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
  if (!isRuleEnabled(rule) || !trigger || rule.triggerType !== trigger.type) {
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

  const targetUrl = normalizeValidUrl(rule.targetUrl);

  if (!targetUrl) {
    return null;
  }

  const triggerType = normalizeTriggerType(rule.triggerType);
  const triggerKey = normalizeTriggerKey(rule.triggerKey);

  if (triggerType === "key" && !triggerKey) {
    return null;
  }

  return {
    id: typeof rule.id === "string" && rule.id ? rule.id : createRuleId(),
    enabled: isRuleEnabled(rule),
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
  return Boolean(normalizeValidUrl(value));
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

function createPresetId() {
  return `preset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isRuleEnabled(rule) {
  return rule?.enabled !== false;
}

async function syncActionBadge() {
  try {
    const result = await chrome.storage.sync.get({
      [STORAGE_KEYS.isEnabled]: false
    });

    await chrome.action.setBadgeBackgroundColor({ color: ENABLED_BADGE_COLOR });
    await chrome.action.setBadgeText({
      text: result[STORAGE_KEYS.isEnabled] ? "ON" : ""
    });
  } catch (error) {
    console.warn("[Quick Side Nav] Failed to update badge:", error);
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function flashActionBadge(text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(syncActionBadge, 1400);
  } catch (error) {
    console.warn("[Quick Side Nav] Failed to flash badge:", error);
  }
}

function getLocalizedMessage(name, fallback) {
  return chrome.i18n?.getMessage?.(name) || fallback;
}
