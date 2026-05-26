const DEFAULT_URL = "https://chatgpt.com/";
const STORAGE_KEY = "targetUrl";

document.addEventListener("DOMContentLoaded", initOptions);

async function initOptions() {
  const form = document.getElementById("settingsForm");
  const input = document.getElementById("targetUrl");

  input.value = await getSavedUrl();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveUrl(input);
  });
}

async function getSavedUrl() {
  const result = await chrome.storage.sync.get({
    [STORAGE_KEY]: DEFAULT_URL
  });
  const url = normalizeUrl(result[STORAGE_KEY]);

  return isValidUrl(url) ? url : DEFAULT_URL;
}

async function saveUrl(input) {
  const url = normalizeUrl(input.value);

  if (!isValidUrl(url)) {
    input.setAttribute("aria-invalid", "true");
    showStatus("有効なURLを入力してください。例：https://example.com/", "error");
    return;
  }

  await chrome.storage.sync.set({ [STORAGE_KEY]: url });
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
