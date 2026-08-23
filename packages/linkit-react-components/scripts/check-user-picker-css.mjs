import { readFileSync } from "node:fs";

const stylesheet = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const required = [
  ".linkit-user-picker { position: relative; display: grid;",
  ".linkit-user-picker__input {",
  ".linkit-user-picker__selection {",
  ".linkit-user-picker__results { position: absolute;",
  ".linkit-user-picker__option {",
  ".linkit-user-picker__option:hover, .linkit-user-picker__option[data-active]",
  ".linkit-user-picker__status, .linkit-user-picker__error",
  "@media (prefers-reduced-motion: reduce) { .linkit-user-picker__input",
];
for (const selector of required) {
  if (!stylesheet.includes(selector)) throw new Error(`LinkitUserPicker stylesheet is missing ${selector}.`);
}
