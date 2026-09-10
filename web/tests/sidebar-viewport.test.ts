import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(
  new URL("../src/components/ui/sidebar.tsx", import.meta.url),
  "utf8",
);

test("shell uses one responsive drawer and a shared app header", () => {
  assert.match(
    app,
    /<TooltipProvider>\s*<SidebarProvider className="h-dvh">\s*<LinkitShell/,
  );
  assert.match(
    app,
    /<Sidebar collapsible="icon">[\s\S]*?<SidebarHeader[\s\S]*?<SidebarContent>/,
  );
  assert.match(
    app,
    /<SidebarInset>[\s\S]*?<SidebarTrigger \/>[\s\S]*?<LinkitMyInfo \/>[\s\S]*?<Routes>/,
  );
  assert.doesNotMatch(app, /<SidebarFooter/);
  assert.match(
    app,
    /function ConversationIndex[\s\S]*?return <ConversationListPage conversations=\{conversations\} sdk=\{sdk\} \/>;/,
  );
  assert.doesNotMatch(app, /function MobileNavigator/);
  assert.doesNotMatch(app, /<div>\{conversationList\}<\/div>/);
});

test("the shared sidebar renders its navigation once on mobile", () => {
  const sidebarComponent = sidebar.slice(
    sidebar.indexOf("function Sidebar({"),
    sidebar.indexOf("function SidebarTrigger"),
  );
  const mobileBranch = sidebarComponent.slice(
    sidebarComponent.indexOf("if (isMobile) {"),
    sidebarComponent.indexOf(
      "\n\n  return (",
      sidebarComponent.indexOf("if (isMobile) {"),
    ),
  );
  assert.equal((mobileBranch.match(/\{children\}/g) ?? []).length, 1);
});
