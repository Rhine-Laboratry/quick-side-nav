(() => {
  function getMessage(name, substitutions, fallback = "") {
    try {
      const message = chrome?.i18n?.getMessage?.(name, substitutions);
      return message || fallback;
    } catch {
      return fallback;
    }
  }

  function getLanguage() {
    try {
      const language = chrome?.i18n?.getUILanguage?.() || navigator.language || "en";
      return language.toLowerCase().startsWith("ja") ? "ja" : "en";
    } catch {
      return "en";
    }
  }

  function localizeDocument(root = document) {
    document.documentElement.lang = getLanguage();

    root.querySelectorAll("[data-i18n]").forEach((element) => {
      const message = getMessage(element.dataset.i18n, undefined, element.textContent);
      if (message) {
        element.textContent = message;
      }
    });

    root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      const message = getMessage(
        element.dataset.i18nAriaLabel,
        undefined,
        element.getAttribute("aria-label") || ""
      );
      if (message) {
        element.setAttribute("aria-label", message);
      }
    });
  }

  globalThis.qsnI18n = {
    getLanguage,
    getMessage,
    localizeDocument
  };

  document.addEventListener("DOMContentLoaded", () => localizeDocument());
})();
