import assert from "node:assert/strict";
import test from "node:test";

import { announceIncomingMessage } from "../src/lib/message-alert.ts";

test("an incoming message shows a system notification when permitted", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const notifications: Array<{ body?: string; title: string }> = [];

  class TestNotification {
    static permission = "granted";

    constructor(title: string, options: { body?: string }) {
      notifications.push({ title, body: options.body });
    }
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { Notification: TestNotification },
  });
  try {
    announceIncomingMessage({ body: "Open Linkit to read it.", title: "New Linkit message" });
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }

  assert.deepEqual(notifications, [
    { body: "Open Linkit to read it.", title: "New Linkit message" },
  ]);
});
