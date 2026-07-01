# Chrome Web Store readiness: Quick Side Nav

Last checked: 2026-07-01

## Current extension behavior

- Manifest V3 extension named `Quick Side Nav`, version `1.2.1`.
- Single user-facing purpose: map user-configured side mouse buttons or key combinations to user-configured `http://` / `https://` URLs, then navigate the current active tab.
- Popup lets the user turn monitoring ON/OFF and open saved rules immediately.
- Options page lets the user add, delete, and save multiple trigger rules.
- Rules and enabled state are stored in `chrome.storage.sync` under settings such as `isEnabled`, `rules`, `targetUrl`, `triggerType`, and `triggerKey`.
- Default destination URL is `https://example.com/` until the user changes it.
- Content script runs on top-level `http://*/*` and `https://*/*` pages at `document_start`.
- Content script listens for trusted side-button mouse events and configured keydown events. It ignores editable fields such as inputs, textareas, selects, and contenteditable elements.
- Background service worker receives trigger messages, checks saved settings, and navigates the active tab to the matching saved URL.
- No analytics, remote code, account login, payment, or external server communication is implemented.

## Chrome Web Store listing copy

### Store name

Quick Side Nav

### Short description

通常のWebページ上で、キー操作やマウスのサイドボタンを登録URLへの移動に割り当てます。

### Detailed description

Quick Side Nav は、通常のWebページ上でよく使う移動先URLをすばやく開くためのChrome拡張機能です。

マウスのサイドボタン、または任意のキー操作を登録URLに割り当てると、その操作で現在のタブを指定したURLへ移動できます。複数のルールを作成できるため、サイドボタンとショートカットキーを別々のURLに割り当てられます。

主な機能:

- マウスのサイドボタン、戻る側、進む側をトリガーに設定
- 任意のキー、または Ctrl / Alt / Shift / Meta と組み合わせたキーをトリガーに設定
- ルールごとに移動先URLを保存
- 拡張機能のポップアップから監視をON/OFF
- 登録済みルールをポップアップから手動で開く

動作範囲:

- 通常の `http://` / `https://` Webページ上で動作します。
- `chrome://` ページ、Chrome Web Store、拡張機能ページ、アドレスバー、タブバー、ブックマークバー上では動作しません。
- 文字入力中の誤操作を避けるため、入力欄やテキストエリアなどではキー操作に反応しません。

プライバシー:

設定したURL、キー設定、ON/OFF状態はChromeの同期ストレージに保存されます。この拡張機能は、ページ本文、閲覧履歴、個人情報を収集したり、開発者のサーバーへ送信したりしません。

### Single purpose statement

通常のWebページ上で、ユーザーが登録したマウスサイドボタンまたはキー操作を、登録済みURLへの現在タブ移動に割り当てること。

### Category

Productivity

## Permissions and host access wording

### `storage`

ユーザーが設定した監視ON/OFF状態、トリガールール、キー設定、移動先URLを保存するために使用します。設定は `chrome.storage.sync` に保存され、拡張機能の動作設定以外には使用しません。

### `http://*/*` and `https://*/*` content script access

通常のWebページ上でユーザーのサイドボタン操作や設定済みキー操作を検知するために必要です。拡張機能はページ本文を読み取らず、フォーム入力値、閲覧履歴、ページURLを保存または送信しません。検知したイベントは、保存済みルールと一致するかどうかの判定と、現在タブの移動にのみ使用します。

### Permissions not requested

- `tabs` permission is not declared.
- No host access for `chrome://` pages is possible or expected.
- No remote-host permissions are used for API calls because the extension does not call external services.

## Privacy and data-use declaration draft

Use this as the starting point for the dashboard privacy fields and privacy policy page.

```text
Quick Side Nav stores only the settings needed to provide its core feature: enabled/disabled state, trigger rules, keyboard shortcut metadata, mouse button selection, and user-entered destination URLs. These settings are stored with Chrome storage so the extension can apply the user's rules.

Quick Side Nav does not collect, sell, transfer, or share personal information. It does not collect page content, form input, browsing history, authentication information, financial information, health information, location, or personal communications. It does not use analytics, advertising, tracking, or remote code.

The extension runs on normal http:// and https:// pages only to detect trusted user input events that match the user's saved trigger rules. Event metadata is used locally to decide whether to navigate the current tab to a saved destination URL. No event data or page data is sent to the developer or to third parties.

User data is used only for the extension's single purpose: assigning user-selected mouse buttons or key combinations to user-selected destination URLs for current-tab navigation.
```

Dashboard data-use answers draft:

- Personally identifiable information: No.
- Health information: No.
- Financial and payment information: No.
- Authentication information: No.
- Personal communications: No.
- Location: No.
- Web history: No collection or transmission. The extension does not store visited page URLs or browsing history.
- Website content: No collection or transmission. The content script only evaluates user input events needed for matching saved triggers.
- User activity: Local-only trigger event handling. Do not mark as collected unless the dashboard treats local-only shortcut metadata or event handling as collection.

## Reviewer test instructions

Use this in the Chrome Web Store dashboard test instructions field.

```text
No account, payment, or external service is required.

1. Install the extension and pin/open the action popup.
2. Open https://example.com/ in a normal tab.
3. Open the extension popup and turn monitoring ON.
4. Open the options page from the popup.
5. Change the default rule destination to https://example.org/ and save.
6. Return to https://example.com/ and reload the page so the content script is active.
7. Press a mouse side button matching the saved rule. The current tab should navigate to the saved URL.
8. To test a keyboard rule, add a new rule, choose key trigger, record a key combination such as Ctrl+Shift+G, set a valid https:// URL, and save.
9. Reload https://example.com/ again, then press the saved key combination while focus is on the page body. The current tab should navigate to the saved URL.
10. Confirm the same key combination does not trigger while typing inside a text field.
11. Turn monitoring OFF in the popup and verify the saved trigger no longer navigates.

Known expected limits: the extension does not run on chrome:// pages, the Chrome Web Store, other extension pages, the address bar, tab bar, or bookmark bar.
```

## Required dashboard assets checklist

Current repo/package state: `manifest.json` declares `icons/icon-16.png`, `icons/icon-32.png`, `icons/icon-48.png`, and `icons/icon-128.png`. The PNG files are present in `icons/`. Store dashboard assets are present in `store-assets/`. `quick-side-nav.zip` has been rebuilt for version `1.2.1`.

- [x] Create the declared icon PNG files, including the required 128x128 extension/store icon.
- [x] At least one 1280x800 or 640x400 screenshot: `store-assets/screenshot-options-1280x800.png`.
- [x] 440x280 small promotional tile PNG or JPEG: `store-assets/promo-small-440x280.png`.
- [x] Privacy policy draft: `PRIVACY.md`. Host this text at a public URL if the dashboard requires a privacy policy URL.
- [ ] Optional 1400x560 marquee promotional tile for better listing presentation.
- [ ] Optional YouTube promo video only if it clearly demonstrates the side-button/key-to-URL workflow.

## Pre-submit checks

- [x] Load unpacked extension in Chrome from the repo folder.
- [x] Confirm `manifest.json` is UTF-8 and valid JSON.
- [x] Confirm all files referenced by `manifest.json`, especially `icons/icon-*.png`, exist.
- [x] Rebuild `quick-side-nav.zip` from the current workspace after the manifest and asset updates.
- [x] Confirm the package does not include `.git`, local notes, store dashboard assets, or build artifacts that are not needed by the extension.
- [x] Confirm the Web Store listing copy matches the actual packaged version.
- [x] Confirm the privacy declaration says only what the current code does.
- [x] Confirm all dashboard permission justifications mention why broad `http://` / `https://` page access is needed for user-trigger detection.

## Automated deploy

Release updates are deployed by the `Chrome Web Store deploy` GitHub Actions workflow.

- Release branches must be named `v<major>.<minor>`, such as `v1.2`.
- The branch name must match the first two parts of `manifest.json` version.
- Pushes to a matching release branch build the ZIP, upload it to Chrome Web Store, and submit it for review.
- Manual workflow runs can upload without publishing by setting `publish=false`.

Required GitHub Secrets:

- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`
- `CWS_PUBLISHER_ID`
- `CWS_EXTENSION_ID`

See `RELEASE.md` for the exact release procedure.

## Official references used

- Chrome Web Store Program Policies: https://developer.chrome.com/docs/webstore/program-policies
- Privacy practices dashboard guidance: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Store listing guidance: https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- Required/optional image assets: https://developer.chrome.com/docs/webstore/images
- Reviewer test instructions: https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions
- Chrome Web Store API: https://developer.chrome.com/docs/webstore/using-api
