const DEFAULT_URL = "https://example.com/";
const DEFAULT_TRIGGER_TYPE = "mouse";
const DEFAULT_MOUSE_BUTTON = "side";
const KEY_CAPTURE_TIMEOUT_MS = 15000;

const STORAGE_KEYS = {
  targetUrl: "targetUrl",
  triggerType: "triggerType",
  triggerKey: "triggerKey",
  rules: "rules",
  urlPresets: "urlPresets"
};

let rules = [];
let urlPresets = [];
let isCapturingKey = false;
let hasUnsavedChanges = false;
let keyCaptureSession = null;

document.addEventListener("DOMContentLoaded", initOptions);

async function initOptions() {
  const savedSettings = await getSavedSettings();
  rules = savedSettings.rules;
  urlPresets = savedSettings.urlPresets;
  renderPresets();
  renderRules();

  document.getElementById("settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveSettings();
  });

  document.getElementById("addPresetButton").addEventListener("click", () => {
    const preset = createUrlPreset();
    urlPresets.push(preset);
    renderPresets();
    renderRules();
    focusPresetInput(preset.id, "targetUrl");
    markDirty("プリセットを追加しました。URLを入力して保存してください。");
  });

  document.getElementById("addRuleButton").addEventListener("click", () => {
    rules.push(createRule());
    renderRules();
    markDirty("ルールを追加しました。保存すると反映されます。");
  });

  document.getElementById("presetsList").addEventListener("input", handlePresetInput);
  document.getElementById("presetsList").addEventListener("click", handlePresetClick);
  document.getElementById("rulesList").addEventListener("input", handleRuleInput);
  document.getElementById("rulesList").addEventListener("change", handleRuleChange);
  document.getElementById("rulesList").addEventListener("click", handleRuleClick);

  window.addEventListener("beforeunload", warnBeforeLeaving);
}

async function getSavedSettings() {
  const result = await chrome.storage.sync.get({
    [STORAGE_KEYS.urlPresets]: null,
    [STORAGE_KEYS.rules]: null,
    [STORAGE_KEYS.targetUrl]: DEFAULT_URL,
    [STORAGE_KEYS.triggerType]: DEFAULT_TRIGGER_TYPE,
    [STORAGE_KEYS.triggerKey]: null
  });

  const savedPresets = getUrlPresetsFromStorage(result);

  return {
    urlPresets: savedPresets,
    rules: getRulesFromStorage(result, savedPresets)
  };
}

function getUrlPresetsFromStorage(result) {
  if (!Array.isArray(result[STORAGE_KEYS.urlPresets])) {
    return [];
  }

  return result[STORAGE_KEYS.urlPresets]
    .map(normalizeUrlPreset)
    .filter(Boolean);
}

function getRulesFromStorage(result, presetList) {
  if (Array.isArray(result[STORAGE_KEYS.rules])) {
    const savedRules = result[STORAGE_KEYS.rules]
      .map((rule) => normalizeRule(rule, presetList))
      .filter(Boolean);

    if (savedRules.length > 0) {
      return savedRules;
    }
  }

  return [createLegacyRule(result)];
}

function createLegacyRule(result) {
  const targetUrl = normalizeUrl(result[STORAGE_KEYS.targetUrl]);

  return normalizeRule({
    id: "legacy-default-rule",
    targetUrl: isValidUrl(targetUrl) ? targetUrl : DEFAULT_URL,
    triggerType: result[STORAGE_KEYS.triggerType],
    mouseButton: DEFAULT_MOUSE_BUTTON,
    triggerKey: result[STORAGE_KEYS.triggerKey]
  }) || createDefaultRule();
}

function renderPresets() {
  const list = document.getElementById("presetsList");
  list.replaceChildren();

  if (urlPresets.length === 0) {
    const empty = document.createElement("p");
    empty.className = "emptyState";
    empty.textContent = "保存済みプリセットはありません。";
    list.appendChild(empty);
    return;
  }

  urlPresets.forEach((preset, index) => {
    list.appendChild(createPresetCard(preset, index));
  });
}

function createPresetCard(preset, index) {
  const card = document.createElement("section");
  card.className = "presetCard";
  card.dataset.presetId = preset.id;
  card.setAttribute("aria-label", `URLプリセット ${index + 1}`);

  const header = document.createElement("header");
  header.className = "ruleHeader";

  const title = document.createElement("h3");
  title.textContent = `プリセット ${index + 1}`;

  const deleteButton = document.createElement("button");
  deleteButton.className = "dangerButton compactButton";
  deleteButton.type = "button";
  deleteButton.dataset.action = "delete-preset";
  deleteButton.textContent = "削除";

  header.append(title, deleteButton);

  const fields = document.createElement("div");
  fields.className = "presetFields";
  fields.append(createPresetLabelField(preset), createPresetUrlField(preset));

  card.append(header, fields);
  return card;
}

function createPresetLabelField(preset) {
  const label = document.createElement("label");
  label.className = "field";

  const text = document.createElement("span");
  text.className = "label";
  text.textContent = "表示名";

  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.maxLength = 80;
  input.placeholder = "例：ChatGPT";
  input.dataset.presetField = "label";
  input.value = preset.label;

  label.append(text, input);
  return label;
}

function createPresetUrlField(preset) {
  const label = document.createElement("label");
  label.className = "field";

  const text = document.createElement("span");
  text.className = "label";
  text.textContent = "URL";

  const input = document.createElement("input");
  input.type = "url";
  input.inputMode = "url";
  input.autocomplete = "url";
  input.spellcheck = false;
  input.placeholder = DEFAULT_URL;
  input.dataset.presetField = "targetUrl";
  input.value = preset.targetUrl;

  label.append(text, input);
  return label;
}

function renderRules() {
  const list = document.getElementById("rulesList");
  list.replaceChildren();

  rules.forEach((rule, index) => {
    list.appendChild(createRuleCard(rule, index));
  });
}

function createRuleCard(rule, index) {
  const card = document.createElement("section");
  card.className = "ruleCard";
  card.dataset.ruleId = rule.id;
  card.setAttribute("aria-label", `起動ルール ${index + 1}`);

  const header = document.createElement("header");
  header.className = "ruleHeader";

  const title = document.createElement("h3");
  title.textContent = `ルール ${index + 1}`;

  const deleteButton = document.createElement("button");
  deleteButton.className = "dangerButton compactButton";
  deleteButton.type = "button";
  deleteButton.dataset.action = "delete-rule";
  deleteButton.textContent = "削除";

  header.append(title, deleteButton);

  const triggerField = createTriggerField(rule);
  const mouseSettings = createMouseSettings(rule);
  const keySettings = createKeySettings(rule);
  const urlField = createUrlField(rule);

  card.append(header, triggerField, mouseSettings, keySettings, urlField);
  return card;
}

function createTriggerField(rule) {
  const label = document.createElement("label");
  label.className = "field";

  const text = document.createElement("span");
  text.className = "label";
  text.textContent = "起動方法";

  const select = document.createElement("select");
  select.dataset.field = "triggerType";

  select.append(
    createOption("mouse", "サイドボタン", rule.triggerType === "mouse"),
    createOption("key", "キー", rule.triggerType === "key")
  );

  label.append(text, select);
  return label;
}

function createMouseSettings(rule) {
  const label = document.createElement("label");
  label.className = "field";
  label.hidden = rule.triggerType !== "mouse";

  const text = document.createElement("span");
  text.className = "label";
  text.textContent = "サイドボタン";

  const select = document.createElement("select");
  select.dataset.field = "mouseButton";

  select.append(
    createOption("side", "どちらのサイドボタンでも", rule.mouseButton === "side"),
    createOption("3", "戻る側のサイドボタン", rule.mouseButton === "3"),
    createOption("4", "進む側のサイドボタン", rule.mouseButton === "4")
  );

  label.append(text, select);
  return label;
}

function createKeySettings(rule) {
  const wrapper = document.createElement("div");
  wrapper.className = "keySettings";
  wrapper.hidden = rule.triggerType !== "key";

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "起動キー";

  const capture = document.createElement("div");
  capture.className = "keyCapture";

  const display = document.createElement("output");
  display.className = "keyDisplay";
  display.textContent = rule.triggerKey ? rule.triggerKey.displayName : "未設定";

  const captureButton = document.createElement("button");
  captureButton.className = "secondaryButton";
  captureButton.type = "button";
  captureButton.dataset.action = "capture-key";
  captureButton.textContent = "キーを記録";

  const clearButton = document.createElement("button");
  clearButton.className = "secondaryButton";
  clearButton.type = "button";
  clearButton.dataset.action = "clear-key";
  clearButton.textContent = "解除";

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "文字入力欄では誤操作防止のため反応しません。Ctrl、Alt、Shiftだけの指定はできません。";

  capture.append(display, captureButton, clearButton);
  wrapper.append(label, capture, hint);
  return wrapper;
}

function createUrlField(rule) {
  const wrapper = document.createElement("div");
  wrapper.className = "urlSettings";

  const presetLabel = document.createElement("label");
  presetLabel.className = "field";

  const presetText = document.createElement("span");
  presetText.className = "label";
  presetText.textContent = "URLプリセット";

  const presetSelect = document.createElement("select");
  presetSelect.dataset.field = "presetId";

  const selectedPresetId = getRulePresetId(rule);

  if (urlPresets.length === 0) {
    presetSelect.append(createOption("", "プリセットなし", true));
    presetSelect.disabled = true;
  } else {
    presetSelect.append(createOption("", "直接入力", selectedPresetId === ""));

    urlPresets.forEach((preset) => {
      presetSelect.append(
        createOption(preset.id, getPresetDisplayName(preset), selectedPresetId === preset.id)
      );
    });
  }

  presetLabel.append(presetText, presetSelect);

  const urlLabel = document.createElement("label");
  urlLabel.className = "field";

  const text = document.createElement("span");
  text.className = "label";
  text.textContent = "移動先URL";

  const input = document.createElement("input");
  input.type = "url";
  input.inputMode = "url";
  input.autocomplete = "url";
  input.spellcheck = false;
  input.placeholder = DEFAULT_URL;
  input.dataset.field = "targetUrl";
  input.value = rule.targetUrl;

  urlLabel.append(text, input);
  wrapper.append(presetLabel, urlLabel);
  return wrapper;
}

function createOption(value, label, selected) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.selected = selected;
  return option;
}

function handlePresetInput(event) {
  const field = event.target?.dataset?.presetField;

  if (!field) {
    return;
  }

  event.target.removeAttribute("aria-invalid");

  const preset = getPresetFromElement(event.target);

  if (!preset) {
    return;
  }

  if (field === "label") {
    preset.label = event.target.value;
    updatePresetOptionLabels(preset);
    markDirty();
    return;
  }

  if (field === "targetUrl") {
    preset.targetUrl = event.target.value;
    updateRulesUsingPreset(preset.id, preset.targetUrl);
    updatePresetOptionLabels(preset);
    markDirty();
  }
}

function handlePresetClick(event) {
  const action = event.target?.dataset?.action;

  if (action !== "delete-preset") {
    return;
  }

  const preset = getPresetFromElement(event.target);

  if (preset) {
    deletePreset(preset.id);
  }
}

function handleRuleInput(event) {
  const field = event.target?.dataset?.field;

  if (field !== "targetUrl") {
    return;
  }

  event.target.removeAttribute("aria-invalid");

  const rule = getRuleFromElement(event.target);

  if (rule) {
    rule.targetUrl = event.target.value;
    rule.presetId = "";
    syncRulePresetSelect(event.target, "");
    markDirty();
  }
}

function handleRuleChange(event) {
  const field = event.target?.dataset?.field;
  const rule = getRuleFromElement(event.target);

  if (!field || !rule) {
    return;
  }

  if (field === "triggerType") {
    rule.triggerType = normalizeTriggerType(event.target.value);
    renderRules();
    markDirty();
    return;
  }

  if (field === "mouseButton") {
    rule.mouseButton = normalizeMouseButton(event.target.value);
    markDirty();
    return;
  }

  if (field === "presetId") {
    applyPresetToRule(rule, event.target.value, event.target);
  }
}

function handleRuleClick(event) {
  const action = event.target?.dataset?.action;

  if (!action) {
    return;
  }

  const rule = getRuleFromElement(event.target);

  if (!rule) {
    return;
  }

  if (action === "delete-rule") {
    deleteRule(rule.id);
    return;
  }

  if (action === "capture-key") {
    startKeyCapture(rule.id, event.target);
    return;
  }

  if (action === "clear-key") {
    rule.triggerKey = null;
    renderRules();
    markDirty("起動キーを解除しました。保存すると反映されます。");
  }
}

function deleteRule(ruleId) {
  if (rules.length <= 1) {
    showStatus("ルールは最低1つ必要です。", "error");
    return;
  }

  rules = rules.filter((rule) => rule.id !== ruleId);
  renderRules();
  markDirty("ルールを削除しました。保存すると反映されます。");
}

function deletePreset(presetId) {
  urlPresets = urlPresets.filter((preset) => preset.id !== presetId);

  rules.forEach((rule) => {
    if (rule.presetId === presetId) {
      rule.presetId = "";
    }
  });

  renderPresets();
  renderRules();
  markDirty("プリセットを削除しました。利用中のルールは直接入力に切り替えました。");
}

function applyPresetToRule(rule, presetId, select) {
  const preset = getPresetById(presetId);
  const card = select.closest("[data-rule-id]");
  const urlInput = card?.querySelector("[data-field='targetUrl']");

  if (!preset) {
    rule.presetId = "";
    syncRulePresetSelect(select, "");
    markDirty();
    return;
  }

  rule.presetId = preset.id;
  rule.targetUrl = preset.targetUrl;

  if (urlInput) {
    urlInput.value = preset.targetUrl;
    urlInput.removeAttribute("aria-invalid");
  }

  markDirty("プリセットを適用しました。保存すると反映されます。");
}

function updateRulesUsingPreset(presetId, targetUrl) {
  rules.forEach((rule) => {
    if (rule.presetId === presetId) {
      rule.targetUrl = targetUrl;

      const card = document.querySelector(`[data-rule-id="${CSS.escape(rule.id)}"]`);
      const input = card?.querySelector("[data-field='targetUrl']");

      if (input) {
        input.value = targetUrl;
      }
    }
  });
}

function updatePresetOptionLabels(preset) {
  document.querySelectorAll("[data-field='presetId']").forEach((select) => {
    Array.from(select.options).forEach((option) => {
      if (option.value === preset.id) {
        option.textContent = getPresetDisplayName(preset);
      }
    });
  });
}

function syncRulePresetSelect(element, presetId) {
  const card = element.closest("[data-rule-id]");
  const select = card?.querySelector("[data-field='presetId']");

  if (select) {
    select.value = presetId;
  }
}

function startKeyCapture(ruleId, button) {
  if (isCapturingKey) {
    return;
  }

  isCapturingKey = true;
  keyCaptureSession = {
    ruleId,
    timeoutId: window.setTimeout(() => {
      cancelKeyCapture("キー記録が時間切れになりました。もう一度「キーを記録」を押してください。", "error");
    }, KEY_CAPTURE_TIMEOUT_MS)
  };

  button.textContent = "キーを押してください";
  button.disabled = true;
  showStatus("起動に使うキーを押してください。Escでキャンセルできます。", "pending");

  window.addEventListener("keydown", handleKeyCaptureKeyDown, { capture: true });
  window.addEventListener("blur", handleKeyCaptureBlur, { once: true });
}

function handleKeyCaptureKeyDown(event) {
  captureKey(event, keyCaptureSession?.ruleId);
}

function handleKeyCaptureBlur() {
  cancelKeyCapture("画面が非アクティブになったため、キー記録をキャンセルしました。", "pending");
}

function captureKey(event, ruleId) {
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    cancelKeyCapture("キー記録をキャンセルしました。", "pending");
    return;
  }

  clearKeyCaptureSession();

  const rule = rules.find((candidate) => candidate.id === ruleId);

  if (!rule) {
    renderRules();
    return;
  }

  if (isModifierOnly(event)) {
    renderRules();
    showStatus("Ctrl、Alt、Shiftだけは指定できません。文字キーやファンクションキーと組み合わせてください。", "error");
    return;
  }

  const triggerKey = serializeKeyboardEvent(event);
  rule.triggerKey = triggerKey;
  renderRules();
  markDirty(getShortcutWarning(triggerKey) || "起動キーを記録しました。保存すると反映されます。");
}

function cancelKeyCapture(message, type) {
  clearKeyCaptureSession();
  renderRules();
  showStatus(message, type);
}

function clearKeyCaptureSession() {
  isCapturingKey = false;
  window.removeEventListener("keydown", handleKeyCaptureKeyDown, { capture: true });
  window.removeEventListener("blur", handleKeyCaptureBlur);

  if (keyCaptureSession?.timeoutId) {
    window.clearTimeout(keyCaptureSession.timeoutId);
  }

  keyCaptureSession = null;
}

async function saveSettings() {
  const normalizedPresets = [];
  const normalizedRules = [];
  clearValidationState();

  for (const [index, preset] of urlPresets.entries()) {
    const validationError = getPresetValidationError(preset, index);

    if (validationError) {
      showStatus(validationError.message, "error");
      focusPresetField(preset.id, validationError.field);
      return;
    }

    const normalizedPreset = normalizeUrlPreset(preset);

    if (!normalizedPreset) {
      showStatus(`プリセット ${index + 1} を確認してください。`, "error");
      return;
    }

    normalizedPresets.push(normalizedPreset);
  }

  for (const [index, rule] of rules.entries()) {
    const validationError = getRuleValidationError(rule, index, normalizedPresets);

    if (validationError) {
      showStatus(validationError.message, "error");
      focusInvalidRuleField(rule.id, validationError.field);
      return;
    }

    const normalizedRule = normalizeRule(rule, normalizedPresets);

    if (!normalizedRule) {
      showStatus(`ルール ${index + 1} を確認してください。`, "error");
      return;
    }

    normalizedRules.push(normalizedRule);
  }

  const duplicateMessage = findDuplicateTriggerMessage(normalizedRules);

  if (duplicateMessage) {
    showStatus(duplicateMessage, "error");
    return;
  }

  await chrome.storage.sync.set({
    [STORAGE_KEYS.urlPresets]: normalizedPresets,
    [STORAGE_KEYS.rules]: normalizedRules,
    [STORAGE_KEYS.targetUrl]: normalizedRules[0].targetUrl,
    [STORAGE_KEYS.triggerType]: normalizedRules[0].triggerType,
    [STORAGE_KEYS.triggerKey]: normalizedRules[0].triggerKey
  });

  urlPresets = normalizedPresets;
  rules = normalizedRules;
  hasUnsavedChanges = false;
  renderPresets();
  renderRules();
  showStatus("保存しました。", "success");
}

function getPresetValidationError(preset, index) {
  const presetNumber = index + 1;
  const targetUrl = normalizeUrl(preset.targetUrl);

  if (!isValidUrl(targetUrl)) {
    return {
      field: "targetUrl",
      message: `プリセット ${presetNumber} のURLを確認してください。https:// または http:// から始まるURLが必要です。`
    };
  }

  return null;
}

function getRuleValidationError(rule, index, presetList = urlPresets) {
  const ruleNumber = index + 1;
  const targetUrl = getRuleTargetUrl(rule, presetList);
  const triggerType = normalizeTriggerType(rule.triggerType);

  if (!isValidUrl(targetUrl)) {
    return {
      field: "targetUrl",
      message: `ルール ${ruleNumber} のURLを確認してください。https:// または http:// から始まるURLが必要です。`
    };
  }

  if (triggerType === "key" && !normalizeTriggerKey(rule.triggerKey)) {
    return {
      field: "triggerKey",
      message: `ルール ${ruleNumber} の起動キーを記録してください。`
    };
  }

  return null;
}

function clearValidationState() {
  document.querySelectorAll("[aria-invalid='true']").forEach((element) => {
    element.removeAttribute("aria-invalid");
  });
}

function focusPresetField(presetId, field) {
  const card = document.querySelector(`[data-preset-id="${CSS.escape(presetId)}"]`);

  if (!card) {
    return;
  }

  const element = card.querySelector(`[data-preset-field='${field}']`);

  if (element) {
    element.setAttribute("aria-invalid", "true");
    element.focus();
  }
}

function focusInvalidRuleField(ruleId, field) {
  const card = document.querySelector(`[data-rule-id="${CSS.escape(ruleId)}"]`);

  if (!card) {
    return;
  }

  const element = field === "targetUrl"
    ? card.querySelector("[data-field='targetUrl']")
    : card.querySelector("[data-action='capture-key']");

  if (element) {
    element.setAttribute("aria-invalid", "true");
    element.focus();
  }
}

function findDuplicateTriggerMessage(ruleList) {
  for (let index = 0; index < ruleList.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < ruleList.length; compareIndex += 1) {
      if (doTriggersOverlap(ruleList[index], ruleList[compareIndex])) {
        return `ルール ${index + 1} とルール ${compareIndex + 1} の起動方法が重複しています。`;
      }
    }
  }

  return "";
}

function doTriggersOverlap(first, second) {
  if (first.triggerType !== second.triggerType) {
    return false;
  }

  if (first.triggerType === "key") {
    return getKeySignature(first.triggerKey) === getKeySignature(second.triggerKey);
  }

  if (first.mouseButton === "side" || second.mouseButton === "side") {
    return true;
  }

  return first.mouseButton === second.mouseButton;
}

function getKeySignature(triggerKey) {
  return [
    triggerKey.code,
    triggerKey.ctrlKey ? "ctrl" : "",
    triggerKey.altKey ? "alt" : "",
    triggerKey.shiftKey ? "shift" : "",
    triggerKey.metaKey ? "meta" : ""
  ].join("|");
}

function getShortcutWarning(triggerKey) {
  const code = triggerKey.code;
  const withCtrlOrMeta = triggerKey.ctrlKey || triggerKey.metaKey;
  const withAlt = triggerKey.altKey;
  const browserShortcutCodes = new Set([
    "KeyL",
    "KeyN",
    "KeyR",
    "KeyT",
    "KeyW",
    "Tab"
  ]);

  if (code === "F5" || code === "F11") {
    return "このキーはブラウザ操作と競合する場合があります。必要なら別のキーに変更してください。保存すると反映されます。";
  }

  if (withCtrlOrMeta && browserShortcutCodes.has(code)) {
    return "このショートカットはブラウザ操作と競合する場合があります。必要なら別のキーに変更してください。保存すると反映されます。";
  }

  if (withAlt && (code === "ArrowLeft" || code === "ArrowRight")) {
    return "このショートカットはブラウザの戻る・進むと競合する場合があります。必要なら別のキーに変更してください。保存すると反映されます。";
  }

  return "";
}

function getRuleFromElement(element) {
  const card = element.closest("[data-rule-id]");
  return card ? rules.find((rule) => rule.id === card.dataset.ruleId) : null;
}

function getPresetFromElement(element) {
  const card = element.closest("[data-preset-id]");
  return card ? urlPresets.find((preset) => preset.id === card.dataset.presetId) : null;
}

function getPresetById(presetId, presetList = urlPresets) {
  return presetList.find((preset) => preset.id === presetId) || null;
}

function getRulePresetId(rule) {
  return getPresetById(rule.presetId) ? rule.presetId : "";
}

function getRuleTargetUrl(rule, presetList = urlPresets) {
  const preset = getPresetById(rule.presetId, presetList);
  return normalizeUrl(preset ? preset.targetUrl : rule.targetUrl);
}

function getPresetDisplayName(preset) {
  return `${preset.label || getDefaultPresetLabel(preset.targetUrl)} - ${preset.targetUrl}`;
}

function focusPresetInput(presetId, field) {
  const card = document.querySelector(`[data-preset-id="${CSS.escape(presetId)}"]`);
  const element = card?.querySelector(`[data-preset-field='${field}']`);

  if (element) {
    element.focus();
  }
}

function createRule() {
  return {
    id: createRuleId(),
    targetUrl: DEFAULT_URL,
    triggerType: "key",
    mouseButton: DEFAULT_MOUSE_BUTTON,
    triggerKey: null,
    presetId: ""
  };
}

function createDefaultRule() {
  return {
    id: createRuleId(),
    targetUrl: DEFAULT_URL,
    triggerType: "mouse",
    mouseButton: DEFAULT_MOUSE_BUTTON,
    triggerKey: null,
    presetId: ""
  };
}

function createUrlPreset() {
  return {
    id: createPresetId(),
    label: "",
    targetUrl: ""
  };
}

function normalizeRule(rule, presetList = urlPresets) {
  if (!rule || typeof rule !== "object") {
    return null;
  }

  const presetId = normalizePresetId(rule.presetId, presetList);
  const targetUrl = getRuleTargetUrl({ ...rule, presetId }, presetList);

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
    triggerKey,
    presetId
  };
}

function normalizeUrlPreset(preset) {
  if (!preset || typeof preset !== "object") {
    return null;
  }

  const targetUrl = normalizeUrl(preset.targetUrl);

  if (!isValidUrl(targetUrl)) {
    return null;
  }

  return {
    id: typeof preset.id === "string" && preset.id ? preset.id : createPresetId(),
    label: normalizePresetLabel(preset.label, targetUrl),
    targetUrl
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

function normalizePresetId(value, presetList = urlPresets) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  return presetList.some((preset) => preset.id === value) ? value : "";
}

function normalizePresetLabel(value, targetUrl) {
  const label = typeof value === "string" ? value.trim() : "";
  return label || getDefaultPresetLabel(targetUrl);
}

function getDefaultPresetLabel(targetUrl) {
  try {
    const url = new URL(targetUrl);
    return url.hostname || "URLプリセット";
  } catch {
    return "URLプリセット";
  }
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

function serializeKeyboardEvent(event) {
  const keyConfig = {
    code: event.code,
    key: event.key,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey
  };

  return {
    ...keyConfig,
    displayName: formatKeyLabel(keyConfig)
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

function createRuleId() {
  return `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createPresetId() {
  return `preset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function markDirty(message = "未保存の変更があります。保存すると反映されます。") {
  hasUnsavedChanges = true;
  showStatus(message, "pending");
}

function warnBeforeLeaving(event) {
  if (!hasUnsavedChanges) {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
}

function showStatus(message, type) {
  const status = document.getElementById("statusMessage");
  status.textContent = message;
  status.className = `status ${type}`;
}
