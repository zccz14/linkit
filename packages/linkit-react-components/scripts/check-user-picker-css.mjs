import { readFileSync } from "node:fs";

const stylesheet = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const required = [
  ".linkit-user-picker { position: relative; display: grid;",
  ".linkit-user-picker__input {",
  ".linkit-user-picker__selection {",
  ".linkit-user-picker__selected-users {",
  ".linkit-user-picker__selected-user {",
  ".linkit-user-picker__clear, .linkit-user-picker__remove {",
  ".linkit-user-picker__results { position: absolute; z-index: 20;",
  ".linkit-user-picker__option { box-sizing: border-box; display: flex; width: 100%; min-width: 0; height: 64px; min-height: 64px;",
  ".linkit-user-picker__option-avatar { width: 28px; height: 28px; border-radius: 50%; }",
  ".linkit-user-picker__option-id { display: block; min-width: 0; overflow-x: auto; overflow-y: hidden;",
  ".linkit-user-picker__option:hover, .linkit-user-picker__option[data-active]",
  ".linkit-user-picker__status, .linkit-user-picker__error",
  "@media (prefers-reduced-motion: reduce) { .linkit-user-picker__input",
];
for (const selector of required) {
  if (!stylesheet.includes(selector)) {
    throw new Error(`LinkitUserPicker stylesheet is missing ${selector}.`);
  }
}
for (const selector of ["#root", "body", "html", ":root"]) {
  if (
    new RegExp(
      `(^|[\n,])\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b`,
      "m",
    ).test(stylesheet)
  ) {
    throw new Error(
      `LinkitUserPicker stylesheet must not target host selector ${selector}.`,
    );
  }
}
