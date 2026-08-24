import { readFileSync } from "node:fs";

const stylesheet = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/user-info.tsx", import.meta.url), "utf8");
const hostSelectors = new Set(["#root", "body", "html", ":root"]);

for (const rule of stylesheet.split("{").slice(0, -1)) {
  const selector = rule.slice(rule.lastIndexOf("}") + 1).trim();
  for (const candidate of selector.split(",").map((value) => value.trim())) {
    if ([...hostSelectors].some((host) => candidate === host || candidate.startsWith(`${host} `) || candidate.startsWith(`${host}:`) || candidate.startsWith(`${host}[`))) {
      throw new Error(`package stylesheet must not modify a host selector: ${candidate}`);
    }
  }
}

if (!source.includes("<PopoverPrimitive.Portal>")) {
  throw new Error("LinkitUserInfo must retain its Base UI PopoverPrimitive.Portal boundary.");
}

if (!source.includes("</PopoverPrimitive.Portal>")) {
  throw new Error("LinkitUserInfo must close its Base UI PopoverPrimitive.Portal boundary.");
}

if (/\.linkit-user-info__popup\s*\{[^}]*\bz-index\s*:/s.test(stylesheet)) {
  throw new Error("LinkitUserInfo popup must not impose a package z-index over consumer layers.");
}
