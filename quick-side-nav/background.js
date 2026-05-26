const DEFAULT_URL = "https://chatgpt.com/";

const STORAGE_KEYS = {
  targetUrl: "targetUrl",
  isEnabled: "isEnabled"
};

const MESSAGE_TYPES = {
  openFromSideButton: "open-configured-url",
  openNow: "open-configured-url-now"
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === MESSAGE_TYPES.openFromSideButton) {
    openConfiguredUrl({ requireEnabled: true })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("[Quick Side Nav] Failed to open URL:", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === MESSAGE_TYPES.openNow) {
    openConfiguredUrl({ requireEnabled: false })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("[Quick Side Nav] Failed to open URL:", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  return false;
});

async function openConfiguredUrl({ requireEnabled }) {
  if (requireEnabled && !(await isSideButtonEnabled())) {
    return;
  }

  const url = await getTargetUrl();
  await openUrlInCurrentTab(url);
}

async function isSideButtonEnabled() {
  const result = await chrome.storage.sync.get({
    [STORAGE_KEYS.isEnabled]: false
  });

  return Boolean(result[STORAGE_KEYS.isEnabled]);
}

async function getTargetUrl() {
  const result = await chrome.storage.sync.get({
    [STORAGE_KEYS.targetUrl]: DEFAULT_URL
  });
  const url = normalizeUrl(result[STORAGE_KEYS.targetUrl]);

  if (isValidUrl(url)) {
    return url;
  }

  return DEFAULT_URL;
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
