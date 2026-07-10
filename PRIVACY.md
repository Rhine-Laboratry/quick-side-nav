# Privacy Policy

## 日本語

Quick Side Nav は個人情報を収集、送信、販売、共有しません。

この拡張機能は、単一目的である「ユーザーが設定した入力で現在のタブを指定URLへ移動する」ために必要な設定だけを保存します。

- 入力監視が有効かどうか
- ユーザーが設定した起動ルール
- ユーザーが入力した移動先URLとURLプリセット名

これらの設定は `chrome.storage.sync` に保存され、Chrome にログインしているブラウザプロファイル間で同期される場合があります。開発者または開発者が管理するサーバーへ送信されることはありません。

Quick Side Nav はページ本文、閲覧履歴、フォーム入力、Cookie、アカウント情報を読み取りません。content script は、通常Webページ上で信頼済みのキー入力とマウスサイドボタン入力を検知し、ユーザーが設定したURLへ現在のタブを移動するためだけに使用されます。

拡張機能を削除した場合、保存データは Chrome の拡張機能ストレージの挙動に従って削除されます。

## English

Quick Side Nav does not collect, transmit, sell, or share personal information.

The extension stores only the settings needed to provide its single purpose:

- whether input monitoring is enabled
- trigger rules selected by the user
- destination URLs and URL preset names entered by the user

These settings are saved with `chrome.storage.sync` so Chrome can synchronize them for the signed-in browser profile. They are not sent to the developer or to any developer-controlled server.

Quick Side Nav does not read page content, browsing history, form inputs, cookies, or account information. Its content script only listens for trusted key and mouse side-button events on regular web pages so it can navigate the current tab to a user-configured URL.

If you remove the extension, Chrome removes the extension's locally stored data according to Chrome's extension storage behavior.
