import { readFileSync } from "node:fs";

const picker = readFileSync(new URL("../src/user-picker.tsx", import.meta.url), "utf8");
const avatar = readFileSync(new URL("../src/displays.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const candidateStart = picker.indexOf("results.map((user, index) => {");
const candidateEnd = picker.indexOf("            : null}", candidateStart);
const candidate = picker.slice(candidateStart, candidateEnd);

if (!picker.includes('import { LinkitAvatar } from "./displays.js";') || (picker.match(/<LinkitAvatar/g) ?? []).length !== 2) {
  throw new Error("LinkitUserPicker must compose LinkitAvatar for result rows and selected identities.");
}
if (!candidate.includes('className="linkit-user-picker__option-avatar"')) {
  throw new Error("LinkitUserPicker result rows must give their composed LinkitAvatar the candidate-only avatar class.");
}
if (!candidate.includes('aria-label={note ? `${note.name}, ${user.username}, ${user.user_id}` : `${user.username}, ${user.user_id}`}')) {
  throw new Error("Candidate result rows must expose the note name, username and complete user ID together to assistive technology.");
}
if (!/<code className="linkit-user-picker__option-id">\s*\{user\.user_id\}/.test(candidate)) {
  throw new Error("Candidate result rows must directly render the complete stable user ID.");
}
if ((picker.match(/<code[^>]*>\s*\{user\.user_id\}/g) ?? []).length !== 2) {
  throw new Error("LinkitUserPicker must render the complete stable user ID through <code> on candidates and selected identities only.");
}
if (/<img\b/.test(picker)) {
  throw new Error("LinkitUserPicker must not clone avatar markup.");
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
