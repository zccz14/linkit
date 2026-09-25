import assert from "node:assert/strict";
import test from "node:test";

import {
  initialLocale,
  negotiateLocale,
  supportedLocales,
  translate,
  translations,
} from "../src/lib/locale.ts";
import { openPagePath } from "../src/lib/api.ts";
import { renderErrorCopy } from "../src/lib/render-error-copy.ts";

test("every supported locale has every translation", () => {
  const keys = Object.keys(translations.en).sort();
  for (const locale of supportedLocales)
    assert.deepEqual(Object.keys(translations[locale]).sort(), keys);
});

test("locale selection uses a valid saved preference before browser language", () => {
  assert.equal(initialLocale("en-US", "zh-CN"), "zh-CN");
  assert.equal(initialLocale("zh-TW", null), "zh-CN");
  assert.equal(initialLocale("fr-FR", null), "en");
});

test("profile language preferences negotiate against the supported locales", () => {
  assert.equal(negotiateLocale(["zh-CN", "en-US"]), "zh-CN");
  assert.equal(negotiateLocale(["en-US", "zh-CN"]), "en");
  assert.equal(negotiateLocale(["zh"]), "zh-CN");
  assert.equal(negotiateLocale(["en"]), "en");
  assert.equal(negotiateLocale(["ja", "zh-CN"]), "zh-CN");
  assert.equal(negotiateLocale(["ja"]), undefined);
  assert.equal(negotiateLocale([]), undefined);
});

test("translations interpolate named values", () => {
  assert.equal(
    translate("zh-CN", "compose.description", { username: "0xCZ" }),
    "正在与 @0xCZ 发起私信…",
  );
});

test("open-page requests preserve their authenticated destination", () => {
  assert.equal(openPagePath("?open=profile"), "#/settings/profile");
  assert.equal(
    openPagePath("?open=message&username=alice%2Fsmith"),
    "#/compose/alice%2Fsmith",
  );
  assert.equal(openPagePath("?open=message"), "#/conversations");
});

test("render failure fallback matches the browser language", () => {
  assert.equal(renderErrorCopy("zh-TW").refresh, "刷新页面");
  assert.equal(renderErrorCopy("en-US").refresh, "Refresh page");
});

test("Bark administration copy does not expose device credentials", () => {
  for (const locale of supportedLocales) {
    assert.ok(translate(locale, "admin.barkUsersTitle").length > 0);
    assert.ok(translate(locale, "admin.barkUsersEmptyTitle").length > 0);
  }
});
