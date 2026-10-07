import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("shell renders one shared AppLayout with a single navigation model", () => {
  assert.match(app, /import \{ AppLayout, type AppNavGroup, type AppNavItem \} from "@zccz14\/ux";/);
  assert.match(app, /<TooltipProvider>\s*<LinkitShell/);
  assert.match(app, /<AppLayout[\s\S]*?<Routes>/);
  assert.doesNotMatch(app, /<SidebarProvider|<SidebarInset|<SidebarFooter/);
  assert.doesNotMatch(app, /useSidebar/);
  assert.match(
    app,
    /function ConversationIndex[\s\S]*?return <ConversationListPage conversations=\{conversations\} sdk=\{sdk\} \/>;/,
  );
  assert.doesNotMatch(app, /function MobileNavigator/);
  assert.doesNotMatch(app, /<div>\{conversationList\}<\/div>/);
});

test("the sidebar navigation models the workspace, tools, and root-only system groups", () => {
  assert.match(app, /label: t\("navigation\.workspace"\)/);
  assert.match(app, /label: t\("navigation\.tools"\)/);
  assert.match(app, /me\.root[\s\S]{0,120}?label: t\("navigation\.system"\)/);
});
