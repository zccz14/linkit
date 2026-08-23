import { readFileSync } from "node:fs";

const stylesheet = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

if (!stylesheet.includes(".linkit-user-info { display: inline-flex; min-width: 100px;")) {
  throw new Error("LinkitUserInfo root must retain min-width: 100px for content-sized containers.");
}

if (!stylesheet.includes(".linkit-user-info__copy { display: grid; min-width: 0;")) {
  throw new Error("LinkitUserInfo text copy must retain internal min-width: 0 for ellipsis within the root width.");
}
