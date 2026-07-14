const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

test("English and Japanese locale catalogs expose the same messages", () => {
  const english = readJson("_locales/en/messages.json");
  const japanese = readJson("_locales/ja/messages.json");

  assert.deepEqual(Object.keys(english).sort(), Object.keys(japanese).sort());
  assert.ok(Object.keys(english).length >= 80);

  for (const [name, definition] of Object.entries(english)) {
    assert.equal(typeof definition.message, "string", `${name} must have an English message`);
    assert.ok(definition.message.length > 0, `${name} must not be empty`);
    assert.equal(typeof japanese[name].message, "string", `${name} must have a Japanese message`);
    assert.ok(japanese[name].message.length > 0, `${name} must not be empty`);
  }
});

test("manifest uses the English catalog as its fallback locale", () => {
  const manifest = readJson("manifest.json");

  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.equal(manifest.description, "__MSG_extensionDescription__");
});

test("popup and options pages load localization before their page scripts", () => {
  for (const fileName of ["popup.html", "options.html"]) {
    const html = fs.readFileSync(path.join(root, fileName), "utf8");
    const localizationIndex = html.indexOf('<script src="i18n.js"></script>');
    const pageScriptIndex = html.indexOf(`<script src="${path.basename(fileName, ".html")}.js"></script>`);

    assert.ok(localizationIndex >= 0, `${fileName} must load i18n.js`);
    assert.ok(pageScriptIndex > localizationIndex, `${fileName} must localize before loading its page script`);
  }
});
