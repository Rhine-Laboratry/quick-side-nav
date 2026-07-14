const DEFAULT_URL = "https://example.com/";
const DEFAULT_TRIGGER_TYPE = "mouse";
const DEFAULT_MOUSE_BUTTON = "side";
const KEY_CAPTURE_TIMEOUT_MS = 15000;
const MAX_URL_LENGTH = 2048;
const MAX_PRESET_LABEL_LENGTH = 80;
const SYNC_ITEM_QUOTA_BYTES = 8192;

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
let isSaving = false;

document.addEventListener("DOMContentLoaded", initOptions);

async function initOptions() {
  try {
    const savedSettings = await getSavedSettings();
    rules = savedSettings.rules;
    urlPresets = savedSettings.urlPresets;
    renderPresets();
    renderRules();
  } catch (error) {
    rules = [createDefaultRule()];
    urlPresets = [];
    renderPresets();
    renderRules();
    const detail = getErrorDetail(error);
    showStatus(
      getLocalizedMessage(
        "settingsLoadError",
        [detail],
        `設定を読み込めませんでした。ページを再読み込みしてください。${detail}`
      ),
      "error"
    );
  }

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
    markDirty(getLocalizedMessage("presetAddedStatus", undefined, "プリセットを追加しました。URLを入力して保存してください。"));
  });

  document.getElementById("addRuleButton").addEventListener("click", () => {
    const rule = createRule();
    rules.push(rule);
    renderRules();
    focusRuleControl(rule.id, "[data-field='triggerType']");
    markDirty(getLocalizedMessage("ruleAddedStatus", undefined, "ルールを追加しました。保存すると反映されます。"));
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

function getRulesFromStorage(result, presetList) {
  if (Array.isArray(result[STORAGE_KEYS.rules])) {
    const savedRules = result[STORAGE_KEYS.rules]
      .map((rule) => normalizeStoredRule(rule, presetList))
      .filter(Boolean);

    if (savedRules.length > 0) {
      return savedRules;
    }
  }

  return [createLegacyRule(result)];
}

function createLegacyRule(result) {
  const targetUrl = normalizeUrl(result[STORAGE_KEYS.targetUrl]);

  return normalizeStoredRule({
    id: "legacy-default-rule",
    targetUrl: targetUrl || DEFAULT_URL,
    triggerType: result[STORAGE_KEYS.triggerType],
    mouseButton: DEFAULT_MOUSE_BUTTON,
    triggerKey: result[STORAGE_KEYS.triggerKey]
  }, []) || createDefaultRule();
}

function renderPresets() {
  const list = document.getElementById("presetsList");
  list.replaceChildren();

  if (urlPresets.length === 0) {
    const empty = document.createElement("p");
    empty.className = "emptyState";
    empty.textContent = getLocalizedMessage("noSavedPresets", undefined, "保存済みプリセットはありません。");
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
  card.setAttribute(
    "aria-label",
    getLocalizedMessage("urlPresetAria", [index + 1], `URLプリセット ${index + 1}`)
  );

  const header = document.createElement("header");
  header.className = "ruleHeader";

  const titleGroup = document.createElement("div");
  titleGroup.className = "presetMeta";

  const title = document.createElement("h3");
  title.textContent = getLocalizedMessage("presetTitle", [index + 1], `プリセット ${index + 1}`);

  const usageCount = countRulesUsingPreset(preset.id);
  const usage = document.createElement("span");
  usage.className = "usageBadge";
  usage.textContent = getRuleUsageLabel(usageCount);

  titleGroup.append(title, usage);

  const deleteButton = document.createElement("button");
  deleteButton.className = "dangerButton compactButton";
  deleteButton.type = "button";
  deleteButton.dataset.action = "delete-preset";
  deleteButton.textContent = getLocalizedMessage("deleteButton", undefined, "削除");
  deleteButton.setAttribute(
    "aria-label",
    getLocalizedMessage("deletePresetAria", [index + 1], `プリセット ${index + 1} を削除`)
  );

  header.append(titleGroup, deleteButton);

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
  text.textContent = getLocalizedMessage("displayNameLabel", undefined, "表示名");

  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.maxLength = MAX_PRESET_LABEL_LENGTH;
  input.placeholder = getLocalizedMessage("displayNamePlaceholder", undefined, "例：ChatGPT");
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
  input.maxLength = MAX_URL_LENGTH;
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
  card.classList.toggle("ruleDisabled", !isRuleEnabled(rule));
  card.dataset.ruleId = rule.id;
  card.setAttribute(
    "aria-label",
    getLocalizedMessage("triggerRuleAria", [index + 1], `起動ルール ${index + 1}`)
  );

  const header = document.createElement("header");
  header.className = "ruleHeader";

  const title = document.createElement("h3");
  title.textContent = getLocalizedMessage("ruleTitle", [index + 1], `ルール ${index + 1}`);

  const headerActions = document.createElement("div");
  headerActions.className = "ruleHeaderActions";
  headerActions.append(createRuleEnabledToggle(rule));

  const deleteButton = document.createElement("button");
  deleteButton.className = "dangerButton compactButton";
  deleteButton.type = "button";
  deleteButton.dataset.action = "delete-rule";
  deleteButton.textContent = getLocalizedMessage("deleteButton", undefined, "削除");
  deleteButton.setAttribute(
    "aria-label",
    getLocalizedMessage("deleteRuleAria", [index + 1], `ルール ${index + 1} を削除`)
  );

  headerActions.append(deleteButton);
  header.append(title, headerActions);

  const triggerField = createTriggerField(rule);
  const mouseSettings = createMouseSettings(rule);
  const keySettings = createKeySettings(rule);
  const urlField = createUrlField(rule);

  card.append(header, triggerField, mouseSettings, keySettings, urlField);
  return card;
}

function createRuleEnabledToggle(rule) {
  const label = document.createElement("label");
  label.className = "ruleEnabledToggle";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.field = "enabled";
  input.checked = isRuleEnabled(rule);

  const text = document.createElement("span");
  text.textContent = getLocalizedMessage("ruleEnabledLabel", undefined, "有効");

  label.append(input, text);
  return label;
}

function createTriggerField(rule) {
  const label = document.createElement("label");
  label.className = "field";

  const text = document.createElement("span");
  text.className = "label";
  text.textContent = getLocalizedMessage("triggerMethodLabel", undefined, "起動方法");

  const select = document.createElement("select");
  select.dataset.field = "triggerType";

  select.append(
    createOption(
      "mouse",
      getLocalizedMessage("sideButtonLabel", undefined, "サイドボタン"),
      rule.triggerType === "mouse"
    ),
    createOption("key", getLocalizedMessage("keyOption", undefined, "キー"), rule.triggerType === "key")
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
  text.textContent = getLocalizedMessage("sideButtonLabel", undefined, "サイドボタン");

  const select = document.createElement("select");
  select.dataset.field = "mouseButton";

  select.append(
    createOption(
      "side",
      getLocalizedMessage("anySideButton", undefined, "どちらのサイドボタンでも"),
      rule.mouseButton === "side"
    ),
    createOption(
      "3",
      getLocalizedMessage("backSideButton", undefined, "戻る側のサイドボタン"),
      rule.mouseButton === "3"
    ),
    createOption(
      "4",
      getLocalizedMessage("forwardSideButton", undefined, "進む側のサイドボタン"),
      rule.mouseButton === "4"
    )
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
  label.textContent = getLocalizedMessage("triggerKeyLabel", undefined, "起動キー");

  const capture = document.createElement("div");
  capture.className = "keyCapture";

  const display = document.createElement("output");
  display.className = "keyDisplay";
  display.textContent = rule.triggerKey
    ? rule.triggerKey.displayName
    : getLocalizedMessage("notSetLabel", undefined, "未設定");

  const captureButton = document.createElement("button");
  captureButton.className = "secondaryButton";
  captureButton.type = "button";
  captureButton.dataset.action = "capture-key";
  captureButton.textContent = getLocalizedMessage("recordKeyButton", undefined, "キーを記録");

  const clearButton = document.createElement("button");
  clearButton.className = "secondaryButton";
  clearButton.type = "button";
  clearButton.dataset.action = "clear-key";
  clearButton.textContent = getLocalizedMessage("clearButton", undefined, "解除");

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = getLocalizedMessage(
    "keyHint",
    undefined,
    "文字入力欄では誤操作防止のため反応しません。Ctrl、Alt、Shiftだけの指定はできません。"
  );

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
  presetText.textContent = getLocalizedMessage("urlPresetLabel", undefined, "URLプリセット");

  const presetSelect = document.createElement("select");
  presetSelect.dataset.field = "presetId";

  const selectedPresetId = getRulePresetId(rule);
  const selectedPreset = getPresetById(selectedPresetId);
  const availablePresets = urlPresets.filter((preset) => {
    return isSelectablePreset(preset) || preset.id === selectedPresetId;
  });

  if (availablePresets.length === 0) {
    presetSelect.append(
      createOption("", getLocalizedMessage("noSavedPresetOption", undefined, "保存済みプリセットなし"), true)
    );
    presetSelect.disabled = true;
  } else {
    presetSelect.append(
      createOption("", getLocalizedMessage("directInputOption", undefined, "直接入力"), selectedPresetId === "")
    );

    availablePresets.forEach((preset) => {
      const option = createOption(
        preset.id,
        getPresetDisplayName(preset),
        selectedPresetId === preset.id
      );
      option.disabled = !isSelectablePreset(preset);
      presetSelect.append(option);
    });
  }

  presetLabel.append(presetText, presetSelect);

  const urlLabel = document.createElement("label");
  urlLabel.className = "field";

  const text = document.createElement("span");
  text.className = "label";
  text.textContent = getLocalizedMessage("destinationUrlLabel", undefined, "移動先URL");

  const input = document.createElement("input");
  input.type = "url";
  input.inputMode = "url";
  input.autocomplete = "url";
  input.spellcheck = false;
  input.placeholder = DEFAULT_URL;
  input.maxLength = MAX_URL_LENGTH;
  input.dataset.field = "targetUrl";
  input.value = selectedPreset ? selectedPreset.targetUrl : rule.targetUrl;
  input.readOnly = Boolean(selectedPreset);

  if (selectedPreset) {
    input.setAttribute(
      "aria-label",
      getLocalizedMessage("linkedUrlAria", undefined, "移動先URL（プリセットに連動中）")
    );
  }

  urlLabel.append(text, input);

  const actions = document.createElement("div");
  actions.className = "urlActions";

  const hint = document.createElement("p");
  hint.className = "linkHint";

  if (selectedPreset) {
    hint.textContent = isSelectablePreset(selectedPreset)
      ? getLocalizedMessage(
        "linkedPresetHint",
        undefined,
        "プリセットに連動中です。URLはプリセット側で変更できます。"
      )
      : getLocalizedMessage(
        "invalidLinkedPresetHint",
        undefined,
        "このプリセットのURLが未設定または不正です。プリセットを編集してください。"
      );

    const editButton = document.createElement("button");
    editButton.className = "secondaryButton inlineButton";
    editButton.type = "button";
    editButton.dataset.action = "edit-preset";
    editButton.textContent = getLocalizedMessage("editPresetButton", undefined, "プリセットを編集");

    const detachButton = document.createElement("button");
    detachButton.className = "secondaryButton inlineButton";
    detachButton.type = "button";
    detachButton.dataset.action = "use-direct-url";
    detachButton.textContent = getLocalizedMessage("switchDirectButton", undefined, "直接入力に切り替える");

    actions.append(hint, editButton, detachButton);
  } else {
    hint.textContent = getLocalizedMessage(
      "directUrlHint",
      undefined,
      "このルールだけで使うURLです。必要ならプリセットとして再利用できます。"
    );

    const saveAsPresetButton = document.createElement("button");
    saveAsPresetButton.className = "secondaryButton inlineButton";
    saveAsPresetButton.type = "button";
    saveAsPresetButton.dataset.action = "save-url-as-preset";
    saveAsPresetButton.textContent = getLocalizedMessage("addToPresetButton", undefined, "プリセットに追加");

    actions.append(hint, saveAsPresetButton);
  }

  wrapper.append(presetLabel, urlLabel, actions);
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
    renderRules();
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

  if (field === "enabled") {
    rule.enabled = event.target.checked;
    renderRules();
    focusRuleControl(rule.id, "[data-field='enabled']");
    markDirty(rule.enabled
      ? getLocalizedMessage("ruleEnabledStatus", undefined, "ルールを有効にしました。保存すると反映されます。")
      : getLocalizedMessage("ruleDisabledStatus", undefined, "ルールを無効にしました。保存すると反映されます。"));
    return;
  }

  if (field === "triggerType") {
    rule.triggerType = normalizeTriggerType(event.target.value);
    renderRules();
    focusRuleControl(rule.id, "[data-field='triggerType']");
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
    focusRuleControl(rule.id, "[data-action='capture-key']");
    markDirty(getLocalizedMessage("keyClearedStatus", undefined, "起動キーを解除しました。保存すると反映されます。"));
    return;
  }

  if (action === "use-direct-url") {
    switchRuleToDirectUrl(rule);
    return;
  }

  if (action === "edit-preset") {
    focusPresetInput(rule.presetId, "label");
    return;
  }

  if (action === "save-url-as-preset") {
    saveRuleUrlAsPreset(rule);
  }
}

function deleteRule(ruleId) {
  if (rules.length <= 1) {
    showStatus(getLocalizedMessage("atLeastOneRuleError", undefined, "ルールは最低1つ必要です。"), "error");
    return;
  }

  const deletedIndex = rules.findIndex((rule) => rule.id === ruleId);
  rules = rules.filter((rule) => rule.id !== ruleId);
  renderPresets();
  renderRules();
  const nextRule = rules[Math.min(Math.max(0, deletedIndex), rules.length - 1)];

  if (nextRule) {
    focusRuleControl(nextRule.id, "[data-field='triggerType']");
  } else {
    document.getElementById("addRuleButton")?.focus();
  }

  markDirty(getLocalizedMessage("ruleDeletedStatus", undefined, "ルールを削除しました。保存すると反映されます。"));
}

function deletePreset(presetId) {
  const usageCount = countRulesUsingPreset(presetId);

  if (usageCount > 0) {
    const fallback = usageCount === 1
      ? "このプリセットは1件のルールで使用中です。削除するとルールは保持済みのURLを直接入力で使い続けます。削除しますか？"
      : `このプリセットは${usageCount}件のルールで使用中です。削除すると各ルールは保持済みのURLを直接入力で使い続けます。削除しますか？`;
    const confirmed = window.confirm(usageCount === 1
      ? getLocalizedMessage("deleteUsedPresetConfirmOne", undefined, fallback)
      : getLocalizedMessage("deleteUsedPresetConfirmMany", [usageCount], fallback));

    if (!confirmed) {
      return;
    }
  }

  const deletedIndex = urlPresets.findIndex((preset) => preset.id === presetId);
  urlPresets = urlPresets.filter((preset) => preset.id !== presetId);

  rules.forEach((rule) => {
    if (rule.presetId === presetId) {
      rule.presetId = "";
    }
  });

  renderPresets();
  renderRules();
  const remainingCards = document.querySelectorAll("[data-preset-id]");
  const nextCardIndex = Math.min(Math.max(0, deletedIndex), remainingCards.length - 1);
  const nextCard = remainingCards[nextCardIndex];
  const nextFocusTarget = nextCard?.querySelector("[data-preset-field='label']")
    || document.getElementById("addPresetButton");
  nextFocusTarget?.focus();
  markDirty(getLocalizedMessage(
    "presetDeletedStatus",
    undefined,
    "プリセットを削除しました。利用中のルールは直接入力に切り替えました。"
  ));
}

function applyPresetToRule(rule, presetId, select) {
  const preset = getPresetById(presetId);
  const card = select.closest("[data-rule-id]");
  const urlInput = card?.querySelector("[data-field='targetUrl']");

  if (!preset) {
    rule.presetId = "";
    syncRulePresetSelect(select, "");
    renderPresets();
    renderRules();
    focusRuleControl(rule.id, "[data-field='targetUrl']");
    markDirty();
    return;
  }

  if (!isSelectablePreset(preset)) {
    showStatus(
      getLocalizedMessage("selectValidPresetError", undefined, "URLを保存済みのプリセットを選んでください。"),
      "error"
    );
    syncRulePresetSelect(select, rule.presetId);
    return;
  }

  rule.presetId = preset.id;
  rule.targetUrl = preset.targetUrl;

  if (urlInput) {
    urlInput.value = preset.targetUrl;
    urlInput.removeAttribute("aria-invalid");
  }

  renderPresets();
  renderRules();
  focusRuleControl(rule.id, "[data-field='presetId']");
  markDirty(getLocalizedMessage("presetAppliedStatus", undefined, "プリセットを適用しました。保存すると反映されます。"));
}

function switchRuleToDirectUrl(rule) {
  rule.presetId = "";
  renderPresets();
  renderRules();

  const card = document.querySelector(`[data-rule-id="${CSS.escape(rule.id)}"]`);
  card?.querySelector("[data-field='targetUrl']")?.focus();
  markDirty(getLocalizedMessage(
    "presetDetachedStatus",
    undefined,
    "プリセットへの連動を解除しました。URLは直接入力で編集できます。"
  ));
}

function saveRuleUrlAsPreset(rule) {
  const targetUrl = normalizeValidUrl(rule.targetUrl);

  if (!targetUrl) {
    showStatus(
      getUrlValidationMessage(
        rule.targetUrl,
        getLocalizedMessage("thisRuleSubject", undefined, "このルール")
      ),
      "error"
    );
    focusInvalidRuleField(rule.id, "targetUrl");
    return;
  }

  const existingPreset = urlPresets.find((preset) => {
    return normalizeValidUrl(preset.targetUrl) === targetUrl;
  });

  if (existingPreset) {
    rule.presetId = existingPreset.id;
    rule.targetUrl = existingPreset.targetUrl;
    renderPresets();
    renderRules();
    focusRuleControl(rule.id, "[data-field='presetId']");
    markDirty(getLocalizedMessage(
      "matchedExistingPresetStatus",
      undefined,
      "同じURLのプリセットに連動しました。保存すると反映されます。"
    ));
    return;
  }

  const preset = createUrlPreset();
  preset.label = getDefaultPresetLabel(targetUrl);
  preset.targetUrl = targetUrl;
  urlPresets.push(preset);
  rule.presetId = preset.id;
  rule.targetUrl = preset.targetUrl;
  renderPresets();
  renderRules();
  focusRuleControl(rule.id, "[data-field='presetId']");
  markDirty(getLocalizedMessage(
    "presetCreatedFromUrlStatus",
    undefined,
    "このURLをプリセットに追加し、ルールを連動しました。保存すると反映されます。"
  ));
}

function countRulesUsingPreset(presetId) {
  return rules.filter((rule) => rule.presetId === presetId).length;
}

function updateRulesUsingPreset(presetId, targetUrl) {
  rules.forEach((rule) => {
    if (rule.presetId === presetId) {
      if (isValidUrl(targetUrl)) {
        rule.targetUrl = normalizeValidUrl(targetUrl);
      }

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
      cancelKeyCapture(
        getLocalizedMessage(
          "captureTimeoutError",
          undefined,
          "キー記録が時間切れになりました。もう一度「キーを記録」を押してください。"
        ),
        "error"
      );
    }, KEY_CAPTURE_TIMEOUT_MS)
  };

  button.textContent = getLocalizedMessage("pressKeyButton", undefined, "キーを押してください");
  button.disabled = true;
  showStatus(
    getLocalizedMessage("pressKeyStatus", undefined, "起動に使うキーを押してください。Escでキャンセルできます。"),
    "pending"
  );

  window.addEventListener("keydown", handleKeyCaptureKeyDown, { capture: true });
  window.addEventListener("blur", handleKeyCaptureBlur, { once: true });
}

function handleKeyCaptureKeyDown(event) {
  captureKey(event, keyCaptureSession?.ruleId);
}

function handleKeyCaptureBlur() {
  cancelKeyCapture(
    getLocalizedMessage(
      "captureBlurCancelled",
      undefined,
      "画面が非アクティブになったため、キー記録をキャンセルしました。"
    ),
    "pending"
  );
}

function captureKey(event, ruleId) {
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    cancelKeyCapture(getLocalizedMessage("captureCancelled", undefined, "キー記録をキャンセルしました。"), "pending");
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
    focusRuleControl(rule.id, "[data-action='capture-key']");
    showStatus(
      getLocalizedMessage(
        "modifiersOnlyError",
        undefined,
        "Ctrl、Alt、Shiftだけは指定できません。文字キーやファンクションキーと組み合わせてください。"
      ),
      "error"
    );
    return;
  }

  const triggerKey = serializeKeyboardEvent(event);
  rule.triggerKey = triggerKey;
  renderRules();
  focusRuleControl(rule.id, "[data-action='capture-key']");
  markDirty(getShortcutWarning(triggerKey) || getLocalizedMessage(
    "keyRecordedStatus",
    undefined,
    "起動キーを記録しました。保存すると反映されます。"
  ));
}

function cancelKeyCapture(message, type) {
  const ruleId = keyCaptureSession?.ruleId;
  clearKeyCaptureSession();
  renderRules();

  if (ruleId) {
    focusRuleControl(ruleId, "[data-action='capture-key']");
  }

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
  if (isSaving) {
    return;
  }

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
      showStatus(
        getLocalizedMessage("checkPresetError", [index + 1], `プリセット ${index + 1} を確認してください。`),
        "error"
      );
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
      showStatus(
        getLocalizedMessage("checkRuleError", [index + 1], `ルール ${index + 1} を確認してください。`),
        "error"
      );
      return;
    }

    normalizedRules.push(normalizedRule);
  }

  const duplicateMessage = findDuplicateTriggerMessage(normalizedRules);

  if (duplicateMessage) {
    showStatus(duplicateMessage, "error");
    return;
  }

  const storageSizeError = getStorageSizeError(normalizedPresets, normalizedRules);

  if (storageSizeError) {
    showStatus(storageSizeError, "error");
    return;
  }

  setSavingState(true);
  showStatus(getLocalizedMessage("savingStatus", undefined, "保存中です…"), "pending");

  try {
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
    showStatus(getLocalizedMessage("savedStatus", undefined, "保存しました。"), "success");
  } catch (error) {
    showStatus(getSaveErrorMessage(error), "error");
  } finally {
    setSavingState(false);
    document.getElementById("saveButton")?.focus?.();
  }
}

function getStorageSizeError(presetList, ruleList) {
  const items = [
    [
      STORAGE_KEYS.urlPresets,
      presetList,
      getLocalizedMessage("urlPresetsStorageLabel", undefined, "URLプリセット")
    ],
    [STORAGE_KEYS.rules, ruleList, getLocalizedMessage("rulesStorageLabel", undefined, "起動ルール")]
  ];

  for (const [key, value, label] of items) {
    const serialized = `${key}${JSON.stringify(value)}`;
    const byteLength = new TextEncoder().encode(serialized).byteLength;

    if (byteLength > SYNC_ITEM_QUOTA_BYTES) {
      return getLocalizedMessage(
        "storageItemTooLargeError",
        [label],
        `${label}のデータ量がChrome同期ストレージの上限を超えています。件数を減らすか、長いURLを短くしてから保存してください。`
      );
    }
  }

  return "";
}

function setSavingState(saving) {
  isSaving = saving;

  const form = document.getElementById("settingsForm");
  const saveButton = document.getElementById("saveButton");

  if (!form) {
    return;
  }

  form.setAttribute("aria-busy", String(saving));

  if (saveButton) {
    saveButton.setAttribute("aria-busy", String(saving));
    saveButton.textContent = saving
      ? getLocalizedMessage("savingButton", undefined, "保存中")
      : getLocalizedMessage("saveButton", undefined, "保存");
  }

  if (saving) {
    form.querySelectorAll("button, input, select").forEach((control) => {
      if (!control.disabled) {
        control.disabled = true;
        control.dataset.disabledForSave = "true";
      }
    });
    return;
  }

  form.querySelectorAll("[data-disabled-for-save='true']").forEach((control) => {
    control.disabled = false;
    delete control.dataset.disabledForSave;
  });
}

function getSaveErrorMessage(error) {
  const detail = error instanceof Error ? error.message : String(error || "");

  if (/quota|bytes per item|max write/i.test(detail)) {
    return getLocalizedMessage(
      "quotaSaveError",
      undefined,
      "設定のデータ量がChrome同期ストレージの上限を超えたため保存できませんでした。件数を減らすか、長いURLを短くしてください。"
    );
  }

  const errorDetail = getErrorDetail(error);
  return getLocalizedMessage(
    "saveError",
    [errorDetail],
    `保存できませんでした。接続状態を確認して、もう一度お試しください。${errorDetail}`
  );
}

function getErrorDetail(error) {
  const detail = error instanceof Error ? error.message : String(error || "");
  return detail ? getLocalizedMessage("errorDetail", [detail], `（${detail}）`) : "";
}

function getPresetValidationError(preset, index) {
  const presetNumber = index + 1;
  const targetUrl = normalizeUrl(preset.targetUrl);

  if (!isValidUrl(targetUrl)) {
    return {
      field: "targetUrl",
      message: getUrlValidationMessage(
        preset.targetUrl,
        getLocalizedMessage("presetSubject", [presetNumber], `プリセット ${presetNumber}`)
      )
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
      message: getUrlValidationMessage(
        targetUrl,
        getLocalizedMessage("ruleSubject", [ruleNumber], `ルール ${ruleNumber}`)
      )
    };
  }

  if (triggerType === "key" && !normalizeTriggerKey(rule.triggerKey)) {
    return {
      field: "triggerKey",
      message: getLocalizedMessage(
        "recordTriggerKeyError",
        [ruleNumber],
        `ルール ${ruleNumber} の起動キーを記録してください。`
      )
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
  const enabledRules = ruleList
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => isRuleEnabled(rule));

  for (let index = 0; index < enabledRules.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < enabledRules.length; compareIndex += 1) {
      if (doTriggersOverlap(enabledRules[index].rule, enabledRules[compareIndex].rule)) {
        const firstRuleNumber = enabledRules[index].index + 1;
        const secondRuleNumber = enabledRules[compareIndex].index + 1;
        return getLocalizedMessage(
          "duplicateTriggerError",
          [firstRuleNumber, secondRuleNumber],
          `ルール ${firstRuleNumber} とルール ${secondRuleNumber} の起動方法が重複しています。`
        );
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
    return getLocalizedMessage(
      "shortcutKeyConflictWarning",
      undefined,
      "このキーはブラウザ操作と競合する場合があります。必要なら別のキーに変更してください。保存すると反映されます。"
    );
  }

  if (withCtrlOrMeta && browserShortcutCodes.has(code)) {
    return getLocalizedMessage(
      "shortcutConflictWarning",
      undefined,
      "このショートカットはブラウザ操作と競合する場合があります。必要なら別のキーに変更してください。保存すると反映されます。"
    );
  }

  if (withAlt && (code === "ArrowLeft" || code === "ArrowRight")) {
    return getLocalizedMessage(
      "shortcutBackForwardConflictWarning",
      undefined,
      "このショートカットはブラウザの戻る・進むと競合する場合があります。必要なら別のキーに変更してください。保存すると反映されます。"
    );
  }

  return "";
}

function getRuleFromElement(element) {
  const card = element.closest("[data-rule-id]");
  return card ? rules.find((rule) => rule.id === card.dataset.ruleId) : null;
}

function focusRuleControl(ruleId, selector) {
  const card = document.querySelector(`[data-rule-id="${CSS.escape(ruleId)}"]`);
  card?.querySelector(selector)?.focus();
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
  const label = normalizePresetLabel(preset.label, preset.targetUrl);
  const targetUrl = normalizeValidUrl(preset.targetUrl);

  if (!targetUrl) {
    return getLocalizedMessage("urlNeedsFixSuffix", [label], `${label}（URLを要修正）`);
  }

  const urlSummary = targetUrl.replace(/^https?:\/\//i, "");
  return `${label} — ${truncateText(urlSummary, 64)}`;
}

function truncateText(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function focusPresetInput(presetId, field) {
  const card = document.querySelector(`[data-preset-id="${CSS.escape(presetId)}"]`);
  const element = card?.querySelector(`[data-preset-field='${field}']`);

  if (element) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    element.focus();
  }
}

function createRule() {
  return {
    id: createRuleId(),
    enabled: true,
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
    enabled: true,
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

function normalizeStoredRule(rule, presetList = urlPresets) {
  if (!rule || typeof rule !== "object") {
    return null;
  }

  const presetId = normalizePresetId(rule.presetId, presetList);
  const preset = getPresetById(presetId, presetList);
  const triggerType = normalizeTriggerType(rule.triggerType);
  const triggerKey = normalizeTriggerKey(rule.triggerKey);

  if (triggerType === "key" && !triggerKey) {
    return null;
  }

  return {
    id: typeof rule.id === "string" && rule.id ? rule.id : createRuleId(),
    enabled: isRuleEnabled(rule),
    targetUrl: normalizeUrl(preset ? preset.targetUrl : rule.targetUrl),
    triggerType,
    mouseButton: normalizeMouseButton(rule.mouseButton),
    triggerKey,
    presetId
  };
}

function normalizeRule(rule, presetList = urlPresets) {
  if (!rule || typeof rule !== "object") {
    return null;
  }

  const presetId = normalizePresetId(rule.presetId, presetList);
  const targetUrl = normalizeValidUrl(getRuleTargetUrl({ ...rule, presetId }, presetList));

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
    triggerKey,
    presetId
  };
}

function normalizeStoredUrlPreset(preset) {
  if (!preset || typeof preset !== "object") {
    return null;
  }

  return {
    id: typeof preset.id === "string" && preset.id ? preset.id : createPresetId(),
    label: typeof preset.label === "string" ? preset.label : "",
    targetUrl: normalizeUrl(preset.targetUrl)
  };
}

function normalizeUrlPreset(preset) {
  if (!preset || typeof preset !== "object") {
    return null;
  }

  const targetUrl = normalizeValidUrl(preset.targetUrl);

  if (!targetUrl) {
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

function getUrlValidationMessage(value, subject) {
  const targetUrl = normalizeUrl(value);

  if (targetUrl.length > MAX_URL_LENGTH) {
    return getLocalizedMessage(
      "urlTooLongError",
      [subject, MAX_URL_LENGTH],
      `${subject}のURLが長すぎます。${MAX_URL_LENGTH}文字以内にしてください。`
    );
  }

  if (/^https?:\/\//i.test(targetUrl)) {
    try {
      const url = new URL(targetUrl);

      if (url.username || url.password) {
        return getLocalizedMessage(
          "credentialsNotAllowedError",
          [subject],
          `${subject}のURLにはユーザー名やパスワードを含められません。`
        );
      }
    } catch {
      // Fall through to the general format message.
    }
  }

  return getLocalizedMessage(
    "invalidUrlError",
    [subject],
    `${subject}のURLを確認してください。https:// または http:// から始まるURLが必要です。`
  );
}

function isSelectablePreset(preset) {
  return Boolean(preset && isValidUrl(preset.targetUrl));
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
  return (label || getDefaultPresetLabel(targetUrl)).slice(0, MAX_PRESET_LABEL_LENGTH);
}

function isRuleEnabled(rule) {
  return rule?.enabled !== false;
}

function getDefaultPresetLabel(targetUrl) {
  try {
    const url = new URL(targetUrl);
    return url.hostname || getLocalizedMessage("defaultPresetLabel", undefined, "URLプリセット");
  } catch {
    return getLocalizedMessage("defaultPresetLabel", undefined, "URLプリセット");
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

function markDirty(message = getLocalizedMessage(
  "unsavedChangesStatus",
  undefined,
  "未保存の変更があります。保存すると反映されます。"
)) {
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
  status.setAttribute("role", type === "error" ? "alert" : "status");
  status.setAttribute("aria-live", type === "error" ? "assertive" : "polite");

  if (status.textContent !== message) {
    status.textContent = message;
  }

  status.className = `status ${type}`;
}

function getRuleUsageLabel(usageCount) {
  if (usageCount === 0) {
    return getLocalizedMessage("unusedLabel", undefined, "未使用");
  }

  if (usageCount === 1) {
    return getLocalizedMessage("ruleUsageOne", undefined, "1件のルールで使用中");
  }

  return getLocalizedMessage("ruleUsageMany", [usageCount], `${usageCount}件のルールで使用中`);
}

function getLocalizedMessage(name, substitutions, fallback) {
  return globalThis.qsnI18n?.getMessage?.(name, substitutions, fallback) || fallback;
}
