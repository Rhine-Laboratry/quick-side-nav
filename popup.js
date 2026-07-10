const DEFAULT_URL = "https://example.com/";
const DEFAULT_TRIGGER_TYPE = "mouse";
const DEFAULT_MOUSE_BUTTON = "side";
const MAX_URL_LENGTH = 2048;

const STORAGE_KEYS = {
  targetUrl: "targetUrl",
  isEnabled: "isEnabled",
  triggerType: "triggerType",
  triggerKey: "triggerKey",
  rules: "rules"
};

const OPEN_NOW_MESSAGE = "open-configured-url-now";

document.addEventListener("DOMContentLoaded", initPopup);

async function initPopup() {
  const toggle = document.getElementById("enabledToggle");
  const optionsButton = document.getElementById("optionsButton");

  const state = await getState();
  toggle.checked = state.isEnabled;
  updateToggleLabel(state.isEnabled);
  renderRules(state.rules);

  toggle.addEventListener("change", async () => {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.isEnabled]: toggle.checked
    });
    updateToggleLabel(toggle.checked);
  });

  document.getElementById("rulesList").addEventListener("click", async (event) => {
    const ruleId = event.target?.dataset?.ruleId;

    if (!ruleId) {
      return;
    }

    await openRule(ruleId, event.target);
  });

  optionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
}

async function getState() {
  const result = await chrome.storage.sync.get({
    [STORAGE_KEYS.targetUrl]: DEFAULT_URL,
    [STORAGE_KEYS.isEnabled]: false,
    [STORAGE_KEYS.triggerType]: DEFAULT_TRIGGER_TYPE,
    [STORAGE_KEYS.triggerKey]: null,
    [STORAGE_KEYS.rules]: null
  });

  return {
    isEnabled: Boolean(result[STORAGE_KEYS.isEnabled]),
    rules: getRulesFromStorage(result)
  };
}

function getRulesFromStorage(result) {
  if (Array.isArray(result[STORAGE_KEYS.rules])) {
    return result[STORAGE_KEYS.rules].map(normalizeRule).filter(Boolean);
  }

  const legacyRule = normalizeRule({
    id: "legacy-default-rule",
    targetUrl: result[STORAGE_KEYS.targetUrl],
    triggerType: result[STORAGE_KEYS.triggerType],
    mouseButton: DEFAULT_MOUSE_BUTTON,
    triggerKey: result[STORAGE_KEYS.triggerKey]
  });

  return legacyRule ? [legacyRule] : [];
}

function renderRules(rules) {
  const list = document.getElementById("rulesList");
  list.replaceChildren();

  rules.forEach((rule) => {
    const item = document.createElement("article");
    item.className = "ruleItem";

    const text = document.createElement("div");
    text.className = "ruleText";

    const trigger = document.createElement("span");
    trigger.className = "ruleTrigger";
    trigger.textContent = getTriggerLabel(rule);

    const url = document.createElement("span");
    url.className = "ruleUrl";
    url.textContent = rule.targetUrl;

    const button = document.createElement("button");
    button.className = "ruleOpenButton";
    button.type = "button";
    button.dataset.ruleId = rule.id;
    button.textContent = "このタブで開く";

    text.append(trigger, url);
    item.append(text, button);
    list.appendChild(item);
  });
}

async function openRule(ruleId, button) {
  setStatus("");
  button.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: OPEN_NOW_MESSAGE,
      ruleId
    });

    if (!response || !response.ok) {
      throw new Error(response?.error || "URLを開けませんでした。");
    }

    window.close();
  } catch (error) {
    setStatus(getErrorMessage(error));
    button.disabled = false;
  }
}

function updateToggleLabel(isEnabled) {
  const stateLabel = document.getElementById("switchState");
  const hintLabel = document.getElementById("switchHint");

  stateLabel.textContent = isEnabled ? "ON" : "OFF";
  hintLabel.textContent = isEnabled
    ? "通常Webページ上で検知します。既に開いているページでは再読み込みが必要です。"
    : "登録済みの入力は反応しません。";
}

function setStatus(message) {
  document.getElementById("statusMessage").textContent = message;
}

function getTriggerLabel(rule) {
  if (rule.triggerType === "key") {
    return rule.triggerKey ? `キー: ${rule.triggerKey.displayName}` : "キー: 未設定";
  }

  if (rule.mouseButton === "3") {
    return "サイドボタン: 戻る側";
  }

  if (rule.mouseButton === "4") {
    return "サイドボタン: 進む側";
  }

  return "サイドボタン";
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
    id: typeof rule.id === "string" && rule.id ? rule.id : "legacy-default-rule",
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

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
