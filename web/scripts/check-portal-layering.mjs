import { readFileSync, readdirSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const builtCss = readdirSync(new URL("../dist/assets/", import.meta.url))
  .filter((file) => file.endsWith(".css"))
  .map((file) => readFileSync(new URL(`../dist/assets/${file}`, import.meta.url), "utf8"))
  .join("\n");

if (!html.includes('<div id="root"></div>')) throw new Error("application mount root must be #root");
if (!source.includes('createRoot(document.getElementById("root")!)')) throw new Error("application must mount React at #root");
if (!/#root\s*\{[^}]*\bisolation\s*:\s*isolate\s*;/s.test(stylesheet)) throw new Error("application root must establish isolation: isolate");
if (!/#root\{[^}]*isolation:isolate/.test(builtCss)) throw new Error("built CSS must retain #root isolation:isolate");
