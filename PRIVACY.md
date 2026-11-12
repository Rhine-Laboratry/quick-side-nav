# Privacy Policy

## 日本語

Quick Side Nav は個人情報を収集、送信、販売、共有しません。

この拡張機能は、単一目的である「ユーザーの操作でタブを指定URLへ移動する」ために必要な設定だけを保存します。

- 入力監視が有効かどうか
- ユーザーが設定した起動ルール
- ユーザーが入力した移動先URLとURLプリセット名
- 2タブ連携の有効状態、移動先URL、待ち時間、実行キー

これらの設定は `chrome.storage.sync` に保存され、Chrome にログインしているブラウザプロファイル間で同期される場合があります。開発者または開発者が管理するサーバーへ送信されることはありません。

2タブ連携で登録したメイン・サブのタブIDは `chrome.storage.session` にのみ保存します。同期されず、ブラウザ再起動や拡張機能の再読み込みで解除されます。

Quick Side Nav はページ本文、閲覧履歴、フォーム入力、Cookie、アカウント情報を読み取りません。content script は、通常Webページ上で信頼済みのキー入力とマウスサイドボタン入力を検知し、タブを登録したり、ユーザーが設定したURLへタブを移動したりするためだけに使用されます。

拡張機能を削除した場合、保存データは Chrome の拡張機能ストレージの挙動に従って削除されます。

## English

Quick Side Nav does not collect, transmit, sell, or share personal information.

The extension stores only the settings needed to provide its single purpose:

- whether input monitoring is enabled
- trigger rules selected by the user
- destination URLs and URL preset names entered by the user
- the two-tab sequence's enabled state, destination URLs, delay, and run key

These settings are saved with `chrome.storage.sync` so Chrome can synchronize them for the signed-in browser profile. They are not sent to the developer or to any developer-controlled server.

The main and sub tab IDs registered for the two-tab sequence are saved only in `chrome.storage.session`. They are not synchronized and are cleared when the browser restarts or the extension reloads.

Quick Side Nav does not read page content, browsing history, form inputs, cookies, or account information. Its content script only listens for trusted key and mouse side-button events on regular web pages so it can register tabs and navigate them to user-configured URLs.

If you remove the extension, Chrome removes the extension's locally stored data according to Chrome's extension storage behavior.
