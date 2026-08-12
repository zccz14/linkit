import assert from "node:assert/strict";
import test from "node:test";

import {
  initialLocale,
  supportedLocales,
  translate,
  translations,
} from "../src/lib/locale.ts";

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

test("translations interpolate named values", () => {
  assert.equal(
    translate("zh-CN", "compose.description", { username: "0xCZ" }),
    "正在与 @0xCZ 发起私信…",
  );
});
