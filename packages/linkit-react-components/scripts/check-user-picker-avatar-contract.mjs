import { readFileSync } from "node:fs";

const picker = readFileSync(new URL("../src/user-picker.tsx", import.meta.url), "utf8");
const avatar = readFileSync(new URL("../src/displays.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const candidateStart = picker.indexOf("results.map((user, index) => (");
const candidateEnd = picker.indexOf("            : null}", candidateStart);
const candidate = picker.slice(candidateStart, candidateEnd);
const outsideCandidate = picker.slice(0, candidateStart) + picker.slice(candidateEnd);

if (!picker.includes('import { LinkitAvatar } from "./displays.js";') || (picker.match(/<LinkitAvatar/g) ?? []).length !== 2) {
  throw new Error("LinkitUserPicker must compose LinkitAvatar for result rows and selected identities.");
}
if (!candidate.includes('className="linkit-user-picker__option-avatar"')) {
  throw new Error("LinkitUserPicker result rows must give their composed LinkitAvatar the candidate-only avatar class.");
}
if (!candidate.includes('aria-label={`${user.username}, ${user.user_id}`}')) {
  throw new Error("Candidate result rows must expose username and user ID together to assistive technology.");
}
if (!candidate.includes('<code className="linkit-user-picker__option-id">\n                      {user.user_id}')) {
  throw new Error("Candidate result rows must directly render the complete stable user ID.");
}
if (/<img\b/.test(picker) || /<code[^>]*>\s*\{user\.user_id\}/.test(outsideCandidate)) {
  throw new Error("LinkitUserPicker must not clone avatar markup or expose raw user IDs outside candidate result rows.");
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
