const DEFAULT_URL = "https://chatgpt.com/";

const STORAGE_KEYS = {
  targetUrl: "targetUrl",
  isEnabled: "isEnabled"
};

const OPEN_NOW_MESSAGE = "open-configured-url-now";

document.addEventListener("DOMContentLoaded", initPopup);

async function initPopup() {
  const toggle = document.getElementById("enabledToggle");
  const openButton = document.getElementById("openButton");
  const optionsButton = document.getElementById("optionsButton");

  const state = await getState();
  toggle.checked = state.isEnabled;
  updateToggleLabel(state.isEnabled);
  setTargetUrl(state.targetUrl);

  toggle.addEventListener("change", async () => {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.isEnabled]: toggle.checked
    });
    updateToggleLabel(toggle.checked);
  });

  openButton.addEventListener("click", async () => {
    await openConfiguredUrl(openButton);
  });

  optionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
}

async function getState() {
  const result = await chrome.storage.sync.get({
    [STORAGE_KEYS.targetUrl]: DEFAULT_URL,
    [STORAGE_KEYS.isEnabled]: false
  });
  const targetUrl = normalizeUrl(result[STORAGE_KEYS.targetUrl]);

  return {
    isEnabled: Boolean(result[STORAGE_KEYS.isEnabled]),
    targetUrl: isValidUrl(targetUrl) ? targetUrl : DEFAULT_URL
  };
}

async function openConfiguredUrl(button) {
  setStatus("");
  button.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: OPEN_NOW_MESSAGE
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
  stateLabel.textContent = isEnabled ? "ON" : "OFF";
}

function setTargetUrl(url) {
  document.getElementById("targetUrl").textContent = url;
}

function setStatus(message) {
  document.getElementById("statusMessage").textContent = message;
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

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
