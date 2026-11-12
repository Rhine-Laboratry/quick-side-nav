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
let twoTabStatus = null;
let twoTabBusy = false;
let twoTabStatusRequest = null;
let twoTabRefreshTimer = null;
let popupClosed = false;

document.addEventListener("DOMContentLoaded", initPopup);
window.addEventListener("unload", () => {
  popupClosed = true;
  clearTimeout(twoTabRefreshTimer);
});

async function initPopup() {
  const toggle = document.getElementById("enabledToggle");
  const optionsButton = document.getElementById("optionsButton");

  initializeTwoTabControls();

  toggle.addEventListener("change", async () => {
    try {
      await chrome.storage.sync.set({
        [STORAGE_KEYS.isEnabled]: toggle.checked
      });
      updateToggleLabel(toggle.checked);
    } catch (error) {
      toggle.checked = !toggle.checked;
      setStatus(getErrorMessage(error));
    }
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

  await Promise.all([
    (async () => {
      try {
        const state = await getState();
        toggle.checked = state.isEnabled;
        updateToggleLabel(state.isEnabled);
        renderRules(state.rules);
      } catch (error) {
        setStatus(getErrorMessage(error));
      }
    })(),
    refreshTwoTabStatus()
  ]);
}

function initializeTwoTabControls() {
  for (const [suffix, role] of [["Main", "main"], ["Sub", "sub"]]) {
    document.getElementById(`twoTabRegister${suffix}`).addEventListener("click", () =>
      runTwoTabAction({ type: "two-tab-register", role }, "twoTabRegisteredSuccess", "タブを登録しました。"));
    document.getElementById(`twoTabClear${suffix}`).addEventListener("click", () =>
      runTwoTabAction({ type: "two-tab-clear", role }, "twoTabClearedSuccess", "登録を解除しました。"));
  }

  document.getElementById("twoTabRun").addEventListener("click", () =>
    runTwoTabAction({ type: "two-tab-run" }, "twoTabRunSuccess", "連携を実行しました。"));
  renderTwoTabStatus();
}

async function refreshTwoTabStatus(reportError = true) {
  clearTimeout(twoTabRefreshTimer);
  twoTabRefreshTimer = null;
  if (twoTabStatusRequest) {
    return twoTabStatusRequest;
  }
  twoTabStatusRequest = loadTwoTabStatus(reportError);
  try {
    return await twoTabStatusRequest;
  } finally {
    twoTabStatusRequest = null;
    scheduleTwoTabStatusRefresh();
  }
}

function scheduleTwoTabStatusRefresh() {
  if (popupClosed || twoTabBusy || !twoTabStatus?.running || twoTabRefreshTimer !== null) {
    return;
  }
  twoTabRefreshTimer = setTimeout(() => {
    twoTabRefreshTimer = null;
    return refreshTwoTabStatus();
  }, 500);
}

async function loadTwoTabStatus(reportError) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "two-tab-status" });
    if (!response?.ok) {
      throw new Error(response?.error || getLocalizedMessage("twoTabStatusError", undefined, "2タブ連携の状態を取得できませんでした。"));
    }
    twoTabStatus = response;
    renderTwoTabStatus();
    return "";
  } catch (error) {
    twoTabStatus = null;
    renderTwoTabStatus();
    const message = getErrorMessage(error);
    if (reportError) {
      setStatus(message);
    }
    return message;
  }
}

function renderTwoTabStatus() {
  const unavailable = twoTabBusy || Boolean(twoTabStatus?.running);
  const registeredLabel = getLocalizedMessage("twoTabRegisteredLabel", undefined, "登録済み");
  const unregisteredLabel = getLocalizedMessage("twoTabUnregisteredLabel", undefined, "未登録");

  document.getElementById("twoTabSection").setAttribute("aria-busy", String(unavailable));
  for (const [suffix, role] of [["Main", "main"], ["Sub", "sub"]]) {
    const registered = Boolean(twoTabStatus?.[`${role}Registered`]);
    document.getElementById(`twoTab${suffix}State`).textContent = twoTabStatus
      ? (registered ? registeredLabel : unregisteredLabel)
      : "—";
    document.getElementById(`twoTabRegister${suffix}`).disabled = unavailable;
    document.getElementById(`twoTabClear${suffix}`).disabled = unavailable || !registered;
  }

  document.getElementById("twoTabRun").disabled = unavailable || !(
    twoTabStatus?.enabled && twoTabStatus.configured
    && twoTabStatus.mainRegistered && twoTabStatus.subRegistered
  );
}

async function runTwoTabAction(message, successKey, successFallback) {
  if (twoTabBusy || twoTabStatus?.running) {
    return;
  }
  twoTabBusy = true;
  clearTimeout(twoTabRefreshTimer);
  twoTabRefreshTimer = null;
  renderTwoTabStatus();
  setStatus("");
  let resultMessage;
  let failed = false;

  try {
    // The service worker resolves the active tab in the window that opened this popup.
    // Keep this popup and that tab in place while registering or running the sequence.
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) {
      throw new Error(response?.error || getLocalizedMessage("twoTabActionError", undefined, "2タブ連携の操作に失敗しました。"));
    }
    resultMessage = getLocalizedMessage(successKey, undefined, successFallback);
  } catch (error) {
    failed = true;
    resultMessage = getErrorMessage(error);
  } finally {
    const statusError = await refreshTwoTabStatus(false);
    twoTabBusy = false;
    renderTwoTabStatus();
    scheduleTwoTabStatusRefresh();
    setStatus(failed ? resultMessage : statusError || resultMessage, failed || Boolean(statusError));
  }
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
    item.classList.toggle("ruleDisabled", !isRuleEnabled(rule));

    const text = document.createElement("div");
    text.className = "ruleText";

    const trigger = document.createElement("span");
    trigger.className = "ruleTrigger";
    trigger.textContent = getTriggerLabel(rule);

    const url = document.createElement("span");
    url.className = "ruleUrl";
    url.textContent = rule.targetUrl;

    const state = document.createElement("span");
    state.className = "ruleState";
    state.textContent = isRuleEnabled(rule)
      ? getLocalizedMessage("ruleActiveLabel", undefined, "有効")
      : getLocalizedMessage("ruleDisabledLabel", undefined, "無効");

    const button = document.createElement("button");
    button.className = "ruleOpenButton";
    button.type = "button";
    button.dataset.ruleId = rule.id;
    button.disabled = !isRuleEnabled(rule);
    button.textContent = getLocalizedMessage("openInThisTabButton", undefined, "このタブで開く");

    text.append(trigger, state, url);
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
      throw new Error(response?.error || getLocalizedMessage("openUrlError", undefined, "URLを開けませんでした。"));
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
    ? getLocalizedMessage(
      "monitoringOnHint",
      undefined,
      "通常Webページ上で検知します。既に開いているページでは再読み込みが必要です。"
    )
    : getLocalizedMessage("monitoringOffHint", undefined, "登録済みの入力は反応しません。");
}

function setStatus(message, isError = true) {
  const status = document.getElementById("statusMessage");
  status.textContent = message;
  status.className = isError ? "status" : "status success";
}

function getTriggerLabel(rule) {
  if (rule.triggerType === "key") {
    return rule.triggerKey
      ? getLocalizedMessage("keyTriggerLabel", [rule.triggerKey.displayName], `キー: ${rule.triggerKey.displayName}`)
      : getLocalizedMessage("keyUnsetLabel", undefined, "キー: 未設定");
  }

  if (rule.mouseButton === "3") {
    return getLocalizedMessage("sideBackLabel", undefined, "サイドボタン: 戻る側");
  }

  if (rule.mouseButton === "4") {
    return getLocalizedMessage("sideForwardLabel", undefined, "サイドボタン: 進む側");
  }

  return getLocalizedMessage("sideButtonLabel", undefined, "サイドボタン");
}

function getLocalizedMessage(name, substitutions, fallback) {
  return globalThis.qsnI18n?.getMessage?.(name, substitutions, fallback) || fallback;
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
    enabled: isRuleEnabled(rule),
    targetUrl,
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
  return typeof error?.message === "string" ? error.message : String(error);
}
