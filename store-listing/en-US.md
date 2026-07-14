# Quick Side Nav — English Chrome Web Store listing

## Name

Quick Side Nav

## Summary

Assign keys and mouse side buttons to saved URLs for fast navigation on regular web pages.

## Detailed description

Quick Side Nav is a Chrome extension for opening frequently used destinations without leaving the keyboard or reaching for the address bar.

Assign a mouse side button or any key combination to a saved URL. When you use that trigger on a regular web page, the current tab navigates to its destination. Create multiple rules to send different keys and side buttons to different URLs.

Features:

- Use either mouse side button, the Back-side button, or the Forward-side button as a trigger
- Use a single key or a combination with Ctrl, Alt, Shift, or Meta
- Save a different destination URL for each rule
- Save frequently used destinations as reusable URL presets
- Link rules to presets so a preset URL change updates every linked rule
- Enable or disable individual rules without deleting them
- Add the current page to URL presets from the page right-click menu
- Turn input monitoring on or off from the extension popup
- Open any saved rule manually from the popup
- Automatic English and Japanese interface based on Chrome's display language

Where it works:

- Works on regular `http://` and `https://` web pages
- Does not run on `chrome://` pages, the Chrome Web Store, other extension pages, the address bar, tab bar, or bookmarks bar
- Key triggers are ignored in standard text fields and editable areas to reduce accidental navigation while typing

Privacy:

Your global enabled state, per-rule enabled state, trigger rules, keyboard shortcut metadata, destination URLs, and URL presets are stored in Chrome sync storage. Quick Side Nav does not collect page content, browsing history, form input, or personal information, and it does not send data to the developer or any developer-controlled server.

## Single-purpose statement

Assign user-selected mouse side buttons or key combinations to user-selected URLs for current-tab navigation on regular web pages.

## Category

Productivity

## Permission justification: storage

Used to save the global enabled state, per-rule enabled state, trigger rules, key settings, destination URLs, and URL presets in `chrome.storage.sync`. The data is used only to provide the extension's navigation feature.

## Permission justification: contextMenus

Used to add a page context-menu item that lets the user save the current regular web page as a URL preset. The item appears only on `http://` and `https://` pages, and the page URL is saved only when the user explicitly selects the menu item.

## Host-access justification: http://*/* and https://*/*

Required to detect the user's saved key or mouse side-button triggers on regular web pages. The extension does not read or transmit page content, form values, browsing history, or page URLs. Trusted input-event metadata is used locally only to match saved rules and navigate the current tab.

## English assets

- Options screenshot: `store-assets/en-US/screenshot-options-1280x800.png`
- Small promotional tile: `store-assets/promo-small-440x280.png` (language neutral)
- Store icon: `store-assets/store-icon-128.png`

## Reviewer test instructions

No account, payment, or external service is required.

1. Install the extension and open its toolbar popup.
2. Open `https://example.com/` in a regular tab.
3. Turn on Input monitoring in the popup.
4. Open Settings from the popup.
5. Change the first rule's destination to `https://example.org/` and save.
6. Return to `https://example.com/` and reload the page.
7. Use the mouse side button selected by the rule. The current tab should navigate to the saved URL.
8. Disable that rule in Settings, save, reload the test page, and confirm the same side button no longer navigates. Re-enable it before continuing.
9. Right-click on `https://example.com/` and choose "Add this page to URL presets". Reopen Settings and confirm the page URL appears as a preset.
10. To test a keyboard rule, add a rule, select Key, record a combination such as Ctrl+Shift+G, enter a valid HTTPS URL, and save.
11. Reload the test page, then press the saved combination while focus is on the page body.
12. Confirm that the combination does not trigger while typing in a standard text field.
13. Turn Input monitoring off and confirm that saved triggers no longer navigate.

Expected limits: the extension does not run on Chrome internal pages, the Chrome Web Store, other extension pages, or browser UI such as the address bar.
