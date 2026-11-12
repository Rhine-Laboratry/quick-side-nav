const DEFAULT_URL = "https://example.com/";

const STORAGE_KEYS = {
  targetUrl: "targetUrl",
  isEnabled: "isEnabled",
  triggerType: "triggerType",
  triggerKey: "triggerKey",
  rules: "rules",
  urlPresets: "urlPresets",
  twoTabSettings: "twoTabSettings"
};

const MESSAGE_TYPES = {
  openFromTrigger: "open-configured-url",
  openNow: "open-configured-url-now",
  twoTabRegister: "two-tab-register",
  twoTabClear: "two-tab-clear",
  twoTabStatus: "two-tab-status",
  twoTabRun: "two-tab-run"
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
const TWO_TAB_TARGETS_KEY = "twoTabTargets";
const DEFAULT_TWO_TAB_KEY = {
  code: "KeyR", key: "r", displayName: "R",
  ctrlKey: false, altKey: false, shiftKey: false, metaKey: false
};
let twoTabRun = null;
let twoTabRevision = 0;
let twoTabTargetMutation = Promise.resolve();

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

  if ((areaName === "sync" && (STORAGE_KEYS.twoTabSettings in changes
    || (twoTabRun?.requireMonitoring && STORAGE_KEYS.isEnabled in changes)))
    || (areaName === "session" && TWO_TAB_TARGETS_KEY in changes)) {
    twoTabRevision += 1;
  }
});

if (chrome.tabs.onRemoved?.addListener) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    mutateTwoTabTargets((targets) => ({
      mainTabId: targets.mainTabId === tabId ? null : targets.mainTabId,
      subTabId: targets.subTabId === tabId ? null : targets.subTabId
    })).catch((error) => console.warn("[Quick Side Nav] Failed to clear closed tab:", error));
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === MESSAGE_TYPES.openFromTrigger) {
    openFromTrigger(message.trigger, sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("[Quick Side Nav] Failed to open URL:", error);
        flashActionBadge("!", ERROR_BADGE_COLOR);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if ([MESSAGE_TYPES.twoTabRegister, MESSAGE_TYPES.twoTabClear,
    MESSAGE_TYPES.twoTabStatus, MESSAGE_TYPES.twoTabRun].includes(message.type)) {
    handleTwoTabMessage(message, sender)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        flashActionBadge("!", ERROR_BADGE_COLOR);
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

async function openFromTrigger(trigger, sender) {
  const settings = await getSettings();

  if (!settings.isEnabled) {
    return;
  }

  const twoTabSettings = await getTwoTabSettings();
  if (twoTabSettings.enabled && trigger?.type === "key") {
    const role = getTwoTabRegistrationRole(trigger);
    if (role) {
      await registerTwoTabTarget(role, sender);
      return;
    }
    if (doesKeyMatch(twoTabSettings.triggerKey, trigger)) {
      await runTwoTabSequence({ requireMonitoring: true });
      return;
    }
  }

  const rule = settings.rules.find((candidate) => doesRuleMatchTrigger(candidate, trigger));

  if (!rule) {
    return;
  }

  await openUrlInCurrentTab(rule.targetUrl);
}

function normalizeTwoTabSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const delayMs = source.delayMs === undefined ? 300 : source.delayMs;
  return {
    enabled: source.enabled === true,
    triggerKey: normalizeTwoTabTriggerKey(source.triggerKey),
    subUrl: normalizeValidUrl(source.subUrl),
    mainUrl: normalizeValidUrl(source.mainUrl),
    delayMs: Number.isInteger(delayMs) && delayMs >= 0 && delayMs <= 10000 ? delayMs : null
  };
}

async function getTwoTabSettings() {
  const stored = await chrome.storage.sync.get({ [STORAGE_KEYS.twoTabSettings]: null });
  return normalizeTwoTabSettings(stored[STORAGE_KEYS.twoTabSettings]);
}

function isTwoTabConfigured(settings) {
  return Boolean(settings.triggerKey && settings.subUrl && settings.mainUrl && settings.delayMs !== null);
}

function normalizeTwoTabTriggerKey(value) {
  if (value === undefined) {
    return { ...DEFAULT_TWO_TAB_KEY };
  }
  const key = normalizeTriggerKey(value);
  if (!key || !key.code.trim() || getTwoTabRegistrationRole(key)
    || /^(Control|Alt|Shift|Meta)(Left|Right)?$/.test(key.code)
    || ["Control", "Alt", "Shift", "Meta", "Unidentified"].includes(key.key)) {
    return null;
  }
  return key;
}

function getTwoTabRegistrationRole(trigger) {
  if (trigger.ctrlKey || trigger.altKey || trigger.shiftKey || trigger.metaKey) {
    return null;
  }
  return trigger.code === "F1" ? "main" : trigger.code === "F2" ? "sub" : null;
}

function assertTwoTabRole(role) {
  if (role !== "main" && role !== "sub") {
    throw new Error(getLocalizedMessage("twoTabInvalidRoleError", "Choose the main or sub tab."));
  }
}

async function readTwoTabTargets() {
  if (!chrome.storage.session) {
    throw new Error(getLocalizedMessage("twoTabSessionError", "Restart or update Chrome to use two-tab actions."));
  }
  const stored = await chrome.storage.session.get({ [TWO_TAB_TARGETS_KEY]: null });
  const targets = stored[TWO_TAB_TARGETS_KEY] || {};
  return {
    mainTabId: Number.isInteger(targets.mainTabId) && targets.mainTabId >= 0 ? targets.mainTabId : null,
    subTabId: Number.isInteger(targets.subTabId) && targets.subTabId >= 0 ? targets.subTabId : null
  };
}

async function getTwoTabTargets() {
  await twoTabTargetMutation;
  return readTwoTabTargets();
}

function mutateTwoTabTargets(change) {
  const mutation = twoTabTargetMutation.then(async () => {
    const previous = await readTwoTabTargets();
    const next = await change(previous);
    if (previous.mainTabId !== next.mainTabId || previous.subTabId !== next.subTabId) {
      twoTabRevision += 1;
      await chrome.storage.session.set({ [TWO_TAB_TARGETS_KEY]: next });
    }
    return next;
  });
  twoTabTargetMutation = mutation.catch(() => {});
  return mutation;
}

async function assertEligibleTwoTabTarget(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error(getLocalizedMessage("twoTabMissingTargetsError", "Register both the main and sub tabs first."));
  }
  try {
    await chrome.tabs.get(tabId);
    // The content script confirms an eligible HTTP/S page without a tabs permission.
    const response = await chrome.tabs.sendMessage(tabId, { type: "two-tab-ping" }, { frameId: 0 });
    if (response?.eligible === true) {
      return;
    }
  } catch {
    // Closed, restricted, or not-yet-injected pages are all ineligible.
  }
  throw new Error(getLocalizedMessage("twoTabPageUnavailableError", "A registered tab is unavailable. Open a normal web page, reload it, and register it again."));
}

async function registerTwoTabTarget(role, sender) {
  assertTwoTabRole(role);
  const tab = Number.isInteger(sender?.tab?.id)
    ? sender.tab
    : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  await mutateTwoTabTargets(async (targets) => {
    await assertEligibleTwoTabTarget(tab?.id);
    const otherRole = role === "main" ? "sub" : "main";
    if (targets[`${otherRole}TabId`] === tab.id) {
      throw new Error(getLocalizedMessage("twoTabDistinctTargetsError", "Register two different tabs as the main and sub tabs."));
    }
    return { ...targets, [`${role}TabId`]: tab.id };
  });
  flashActionBadge(role === "main" ? "M" : "S", ADDED_BADGE_COLOR);
}

async function handleTwoTabMessage(message, sender) {
  if (message.type === MESSAGE_TYPES.twoTabRegister) {
    await registerTwoTabTarget(message.role, sender);
  } else if (message.type === MESSAGE_TYPES.twoTabClear) {
    assertTwoTabRole(message.role);
    await mutateTwoTabTargets((targets) => ({ ...targets, [`${message.role}TabId`]: null }));
  } else if (message.type === MESSAGE_TYPES.twoTabRun) {
    await runTwoTabSequence();
  } else {
    const settings = await getTwoTabSettings();
    const targets = await getTwoTabTargets();
    const registration = await Promise.allSettled([
      assertEligibleTwoTabTarget(targets.mainTabId),
      assertEligibleTwoTabTarget(targets.subTabId)
    ]);
    return {
      enabled: settings.enabled,
      configured: isTwoTabConfigured(settings),
      running: twoTabRun !== null,
      mainRegistered: registration[0].status === "fulfilled",
      subRegistered: targets.mainTabId !== targets.subTabId && registration[1].status === "fulfilled"
    };
  }
  return {};
}

async function assertTwoTabRunUnchanged(run) {
  const stored = await chrome.storage.sync.get({
    [STORAGE_KEYS.isEnabled]: false,
    [STORAGE_KEYS.twoTabSettings]: null
  });
  const current = normalizeTwoTabSettings(stored[STORAGE_KEYS.twoTabSettings]);
  const targets = await getTwoTabTargets();
  if (run.revision !== twoTabRevision || !current.enabled
    || JSON.stringify(current) !== run.settingsSignature
    || targets.mainTabId !== run.targets.mainTabId || targets.subTabId !== run.targets.subTabId
    || (run.requireMonitoring && !stored[STORAGE_KEYS.isEnabled])) {
    throw new Error(getLocalizedMessage("twoTabCancelledError", "The two-tab action stopped because its settings or registered tabs changed."));
  }
}

async function runTwoTabSequence({ requireMonitoring = false } = {}) {
  if (twoTabRun) {
    throw new Error(getLocalizedMessage("twoTabAlreadyRunningError", "A two-tab action is already running."));
  }
  const run = { requireMonitoring, revision: twoTabRevision };
  twoTabRun = run;
  try {
    const settings = await getTwoTabSettings();
    if (!settings.enabled) {
      throw new Error(getLocalizedMessage("twoTabDisabledError", "Enable two-tab actions in settings first."));
    }
    if (!isTwoTabConfigured(settings)) {
      throw new Error(getLocalizedMessage("twoTabInvalidSettingsError", "Set a valid run key, main and sub URLs, and a delay from 0 to 10,000 ms."));
    }
    const targets = await getTwoTabTargets();
    if (targets.mainTabId === null || targets.subTabId === null) {
      throw new Error(getLocalizedMessage("twoTabMissingTargetsError", "Register both the main and sub tabs first."));
    }
    if (targets.mainTabId === targets.subTabId) {
      throw new Error(getLocalizedMessage("twoTabDistinctTargetsError", "Register two different tabs as the main and sub tabs."));
    }
    run.targets = targets;
    run.settingsSignature = JSON.stringify(settings);
    await Promise.all([
      assertEligibleTwoTabTarget(targets.mainTabId),
      assertEligibleTwoTabTarget(targets.subTabId)
    ]);
    await assertTwoTabRunUnchanged(run);
    await chrome.tabs.update(targets.subTabId, { url: settings.subUrl });
    await new Promise((resolve) => setTimeout(resolve, settings.delayMs));
    await assertTwoTabRunUnchanged(run);
    await assertEligibleTwoTabTarget(targets.mainTabId);
    await assertTwoTabRunUnchanged(run);
    await chrome.tabs.update(targets.mainTabId, { url: settings.mainUrl });
  } finally {
    twoTabRun = null;
  }
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
