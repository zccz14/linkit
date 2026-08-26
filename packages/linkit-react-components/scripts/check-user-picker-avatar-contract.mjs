import { readFileSync } from "node:fs";

const picker = readFileSync(new URL("../src/user-picker.tsx", import.meta.url), "utf8");
const avatar = readFileSync(new URL("../src/displays.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

if (!picker.includes('import { LinkitAvatar } from "./displays.js";') || (picker.match(/<LinkitAvatar/g) ?? []).length !== 2) {
  throw new Error("LinkitUserPicker must compose LinkitAvatar for result rows and selected identities.");
}
if (/<img\b/.test(picker) || /<code>\{user\.user_id\}<\/code>/.test(picker)) {
  throw new Error("LinkitUserPicker must not clone avatar markup or visually expose raw user IDs.");
}
for (const forbidden of ["fetch(", "createObjectURL", "new Blob", "data:", "cache-buster"]) {
  if (avatar.includes(forbidden)) throw new Error(`LinkitAvatar must not use ${forbidden}.`);
}
if (!avatar.includes('<img {...props} className="linkit-avatar__image" src={avatarUrl!} alt=""')) {
  throw new Error("LinkitAvatar must render the profile avatar URL directly as a native image source.");
}
for (const selector of [".linkit-avatar {", ".linkit-avatar--sm { width: 1.5rem; height: 1.5rem;", ".linkit-avatar--lg { width: 2.5rem; height: 2.5rem;", ".linkit-avatar__image { object-fit: cover; }"]) {
  if (!stylesheet.includes(selector)) throw new Error(`LinkitAvatar stylesheet is missing ${selector}.`);
}
