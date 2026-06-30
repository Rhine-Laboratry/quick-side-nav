const DEFAULT_URL = "https://chatgpt.com/";
const DEFAULT_TRIGGER_TYPE = "mouse";

const STORAGE_KEYS = {
  targetUrl: "targetUrl",
  triggerType: "triggerType",
  triggerKey: "triggerKey"
};

let selectedTriggerKey = null;
let isCapturingKey = false;

document.addEventListener("DOMContentLoaded", initOptions);

async function initOptions() {
  const form = document.getElementById("settingsForm");
  const input = document.getElementById("targetUrl");
  const captureButton = document.getElementById("captureKeyButton");
  const clearButton = document.getElementById("clearKeyButton");
  const triggerInputs = getTriggerTypeInputs();

  const settings = await getSavedSettings();
  input.value = settings.targetUrl;
  selectedTriggerKey = settings.triggerKey;
  setTriggerType(settings.triggerType);
  updateTriggerKeyDisplay();
  updateKeySettingsState();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveSettings(input);
  });

  for (const triggerInput of triggerInputs) {
    triggerInput.addEventListener("change", updateKeySettingsState);
  }

  captureButton.addEventListener("click", startKeyCapture);

  clearButton.addEventListener("click", () => {
    selectedTriggerKey = null;
    updateTriggerKeyDisplay();
    showStatus("起動キーを解除しました。保存すると反映されます。", "success");
  });
}

async function getSavedSettings() {
  const result = await chrome.storage.sync.get({
    [STORAGE_KEYS.targetUrl]: DEFAULT_URL,
    [STORAGE_KEYS.triggerType]: DEFAULT_TRIGGER_TYPE,
    [STORAGE_KEYS.triggerKey]: null
  });
  const url = normalizeUrl(result[STORAGE_KEYS.targetUrl]);

  return {
    targetUrl: isValidUrl(url) ? url : DEFAULT_URL,
    triggerType: normalizeTriggerType(result[STORAGE_KEYS.triggerType]),
    triggerKey: normalizeTriggerKey(result[STORAGE_KEYS.triggerKey])
  };
}

async function saveSettings(input) {
  const url = normalizeUrl(input.value);
  const triggerType = getSelectedTriggerType();

  if (!isValidUrl(url)) {
    input.setAttribute("aria-invalid", "true");
    showStatus("有効なURLを入力してください。例：https://example.com/", "error");
    return;
  }

  if (triggerType === "key" && !selectedTriggerKey) {
    showStatus("起動キーを記録してください。", "error");
    return;
  }

  await chrome.storage.sync.set({
    [STORAGE_KEYS.targetUrl]: url,
    [STORAGE_KEYS.triggerType]: triggerType,
    [STORAGE_KEYS.triggerKey]: selectedTriggerKey
  });
  input.setAttribute("aria-invalid", "false");
  showStatus("保存しました。", "success");
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

function showStatus(message, type) {
  const status = document.getElementById("statusMessage");
  status.textContent = message;
  status.className = `status ${type}`;
}

function startKeyCapture() {
  if (isCapturingKey) {
    return;
  }

  isCapturingKey = true;
  const captureButton = document.getElementById("captureKeyButton");
  captureButton.textContent = "キーを押してください";
  captureButton.disabled = true;
  showStatus("起動に使うキーを押してください。", "success");

  window.addEventListener("keydown", captureKey, {
    capture: true,
    once: true
  });
}

function captureKey(event) {
  event.preventDefault();
  event.stopPropagation();

  const captureButton = document.getElementById("captureKeyButton");
  captureButton.textContent = "キーを記録";
  captureButton.disabled = false;
  isCapturingKey = false;

  if (isModifierOnly(event)) {
    showStatus("Ctrl、Alt、Shiftだけは指定できません。文字キーやファンクションキーと組み合わせてください。", "error");
    return;
  }

  selectedTriggerKey = serializeKeyboardEvent(event);
  updateTriggerKeyDisplay();
  showStatus("起動キーを記録しました。保存すると反映されます。", "success");
}

function serializeKeyboardEvent(event) {
  const displayName = formatKeyLabel({
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey
  });

  return {
    code: event.code,
    key: event.key,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    displayName
  };
}

function updateTriggerKeyDisplay() {
  const display = document.getElementById("triggerKeyDisplay");
  display.value = selectedTriggerKey ? selectedTriggerKey.displayName : "未設定";
  display.textContent = display.value;
}

function updateKeySettingsState() {
  const isKeyMode = getSelectedTriggerType() === "key";
  const keySettings = document.getElementById("keySettings");
  keySettings.hidden = !isKeyMode;
}

function getSelectedTriggerType() {
  return document.querySelector("input[name='triggerType']:checked")?.value || DEFAULT_TRIGGER_TYPE;
}

function setTriggerType(triggerType) {
  const normalizedTriggerType = normalizeTriggerType(triggerType);
  document.querySelector(`input[name='triggerType'][value='${normalizedTriggerType}']`).checked = true;
}

function getTriggerTypeInputs() {
  return Array.from(document.querySelectorAll("input[name='triggerType']"));
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
    displayName: typeof value.displayName === "string" ? value.displayName : formatKeyLabel(value)
  };
}

function isModifierOnly(event) {
  return ["Control", "Alt", "Shift", "Meta"].includes(event.key);
}

function formatKeyLabel(keyConfig) {
  const parts = [];

  if (keyConfig.ctrlKey) parts.push("Ctrl");
  if (keyConfig.altKey) parts.push("Alt");
  if (keyConfig.shiftKey) parts.push("Shift");
  if (keyConfig.metaKey) parts.push("Meta");

  parts.push(formatBaseKey(keyConfig.key, keyConfig.code));
  return parts.join(" + ");
}

function formatBaseKey(key, code) {
  if (key === " ") {
    return "Space";
  }

  if (key && key.length === 1) {
    return key.toUpperCase();
  }

  return key || code || "Unknown";
}
