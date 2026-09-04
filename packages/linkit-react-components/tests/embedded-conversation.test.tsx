import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventMessage = {
  id: string;
  conversation_id: string;
  sender_kind: "user" | "bot";
  sender_id: string;
  sender_name: string;
  sender_deleted: boolean;
  body: string;
  urgent: boolean;
  created_at: number;
  attachments: Array<never>;
  cursor: string;
};

const { linkit, messageListener } = vi.hoisted(() => {
  let listener: ((message: EventMessage) => void) | undefined;
  return {
    messageListener: {
      emit(message: EventMessage) {
        listener?.(message);
      },
      set(next: ((message: EventMessage) => void) | undefined) {
        listener = next;
      },
    },
    linkit: {
      getMe: vi.fn(),
      getConversation: vi.fn(),
      listMessages: vi.fn(),
      sendMessage: vi.fn(),
      markConversationRead: vi.fn(),
      upload: vi.fn(),
      downloadAttachment: vi.fn(),
      subscribeToConversationMessages: vi.fn(
        (_id: string, next: ((message: EventMessage) => void) | undefined) => {
          messageListener.set(next);
          return () => messageListener.set(undefined);
        },
      ),
    },
  };
});

vi.mock("../src/linkit-provider.js", () => ({ useLinkit: () => linkit }));

import { LinkitEmbeddedConversation } from "../src/embedded-conversation.js";

const firstMessage = {
  id: "message-1",
  conversation_id: "conversation-1",
  sender_kind: "user" as const,
  sender_id: "alice-id",
  sender_name: "alice",
  sender_deleted: false,
  body: "Hello from Alice",
  urgent: false,
  created_at: 1,
  attachments: [],
  cursor: "1:1",
};

beforeEach(() => {
  vi.clearAllMocks();
  linkit.getMe.mockResolvedValue({ id: "viewer-id", root: false });
  linkit.getConversation.mockResolvedValue({
    id: "conversation-1",
    kind: "group",
    title: "Research",
  });
  linkit.listMessages.mockResolvedValue({
    messages: [firstMessage],
    older_cursor: "0:1",
  });
  linkit.sendMessage.mockResolvedValue({
    ...firstMessage,
    id: "message-2",
    sender_id: "viewer-id",
    sender_name: "viewer",
    body: "A reply",
    cursor: "2:2",
  });
  linkit.markConversationRead.mockResolvedValue(undefined);
  linkit.downloadAttachment.mockResolvedValue(new Blob(["attachment"]));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LinkitEmbeddedConversation", () => {
  it("loads an authorized conversation, sends a message, and shows real-time member messages", async () => {
    render(<LinkitEmbeddedConversation conversationId="conversation-1" />);

    expect(await screen.findByText("Hello from Alice")).toBeInTheDocument();
    expect(screen.getByText("Research")).toBeInTheDocument();
    expect(linkit.getConversation).toHaveBeenCalledWith("conversation-1");
    expect(linkit.markConversationRead).toHaveBeenCalledWith("conversation-1");

    fireEvent.change(screen.getByPlaceholderText("Write a message…"), {
      target: { value: "A reply" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(linkit.sendMessage).toHaveBeenCalledWith("conversation-1", {
        body: "A reply",
        attachmentIds: [],
        urgent: false,
      }),
    );
    expect(await screen.findByText("A reply")).toBeInTheDocument();

    messageListener.emit({
      ...firstMessage,
      id: "message-3",
      body: "A real-time update",
      cursor: "3:3",
    });
    expect(await screen.findByText("A real-time update")).toBeInTheDocument();
  });

  it("uses localized unavailable copy when the current user is not a conversation member", async () => {
    linkit.getConversation.mockRejectedValue(
      new Error("conversation not found"),
    );
    render(
      <LinkitEmbeddedConversation conversationId="forbidden" lang="zh-CN" />,
    );

    expect(await screen.findByText("无法访问此聊天。")).toBeInTheDocument();
    expect(screen.getByText("conversation not found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() =>
      expect(linkit.getConversation).toHaveBeenCalledTimes(2),
    );
  });

  it("uploads a selected attachment before sending its message", async () => {
    const attachment = {
      id: "attachment-1",
      file_name: "notes.txt",
      media_type: "text/plain",
      byte_size: 5,
      created_at: 1,
    };
    linkit.upload.mockResolvedValue(attachment);
    render(<LinkitEmbeddedConversation conversationId="conversation-1" />);
    await screen.findByText("Hello from Alice");

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File(["notes"], "notes.txt", { type: "text/plain" })],
      },
    });
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(linkit.sendMessage).toHaveBeenCalledWith("conversation-1", {
        body: "",
        attachmentIds: ["attachment-1"],
        urgent: false,
      }),
    );
  });
});

it("renders an authorized direct conversation by its counterpart identity", async () => {
  linkit.getConversation.mockResolvedValue({
    id: "conversation-1",
    kind: "direct",
    counterpart_name: "bob",
  });
  render(<LinkitEmbeddedConversation conversationId="conversation-1" />);

  expect(await screen.findByText("bob")).toBeInTheDocument();
  expect(screen.getAllByLabelText("bob")).toHaveLength(2);
});
