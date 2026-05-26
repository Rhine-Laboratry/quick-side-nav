const SIDE_BUTTONS = new Set([3, 4]);
const COOLDOWN_MS = 300;
const MESSAGE_TYPE = "open-configured-url";
const LISTENER_OPTIONS = {
  capture: true,
  passive: false
};

let lastTriggeredAt = 0;

for (const eventName of ["mousedown", "mouseup", "auxclick"]) {
  window.addEventListener(eventName, handleMouseEvent, LISTENER_OPTIONS);
  document.addEventListener(eventName, handleMouseEvent, LISTENER_OPTIONS);
}

function handleMouseEvent(event) {
  if (!event.isTrusted || !SIDE_BUTTONS.has(event.button)) {
    return;
  }

  suppressEvent(event);

  const now = Date.now();
  if (now - lastTriggeredAt < COOLDOWN_MS) {
    return;
  }

  lastTriggeredAt = now;
  chrome.runtime.sendMessage({ type: MESSAGE_TYPE }, () => {
    chrome.runtime.lastError;
  });
}

function suppressEvent(event) {
  if (event.cancelable) {
    event.preventDefault();
  }

  event.stopPropagation();

  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
}
