import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  ChevronDown,
  FileText,
  LoaderCircle,
  Paperclip,
  Send,
  TriangleAlert,
} from "lucide-react";
import { clsx } from "clsx";
import { LinkitConversationDisplay } from "./displays.js";
import { useLinkit } from "./linkit-provider.js";
import type { LinkitAttachment, LinkitMessage } from "./types.js";

export type LinkitEmbeddedConversationLabels = {
  loading: string;
  unavailable: string;
  retry: string;
  empty: string;
  loadOlder: string;
  loadingOlder: string;
  newMessages: string;
  writeMessage: string;
  send: string;
  sending: string;
  attachFile: string;
  urgent: string;
  urgentNotice: string;
  composeHint: string;
  attachmentDownload: string;
  deletedBot: string;
  bot: string;
};

export type LinkitEmbeddedConversationProps = {
  conversationId: string;
  className?: string;
  lang?: "en" | "zh" | "zh-CN";
  labels?: Partial<LinkitEmbeddedConversationLabels>;
};

const english: LinkitEmbeddedConversationLabels = {
  loading: "Loading conversation…",
  unavailable: "This conversation is unavailable.",
  retry: "Retry",
  empty: "No messages yet. Start the conversation below.",
  loadOlder: "Load earlier messages",
  loadingOlder: "Loading earlier messages…",
  newMessages: "New messages",
  writeMessage: "Write a message…",
  send: "Send",
  sending: "Sending…",
  attachFile: "Attach file",
  urgent: "Urgent",
  urgentNotice: "Urgent messages notify every conversation member.",
  composeHint: "Enter to send · Shift+Enter for a new line",
  attachmentDownload: "Download attachment",
  deletedBot: "Deleted bot",
  bot: "Bot",
};

const chinese: LinkitEmbeddedConversationLabels = {
  loading: "正在加载聊天…",
  unavailable: "无法访问此聊天。",
  retry: "重试",
  empty: "还没有消息。在下方开始聊天。",
  loadOlder: "加载更早的消息",
  loadingOlder: "正在加载更早的消息…",
  newMessages: "新消息",
  writeMessage: "输入消息…",
  send: "发送",
  sending: "正在发送…",
  attachFile: "附加文件",
  urgent: "加急",
  urgentNotice: "加急消息会通知此聊天的所有成员。",
  composeHint: "Enter 发送 · Shift+Enter 换行",
  attachmentDownload: "下载附件",
  deletedBot: "已删除机器人",
  bot: "机器人",
};

export function LinkitEmbeddedConversation({
  conversationId,
  className,
  lang = "en",
  labels: labelsOverride,
}: LinkitEmbeddedConversationProps) {
  const linkit = useLinkit();
  const labels = useMemo(
    () => ({
      ...(lang === "zh" || lang === "zh-CN" ? chinese : english),
      ...labelsOverride,
    }),
    [lang, labelsOverride],
  );
  const [meId, setMeId] = useState("");
  const [conversation, setConversation] = useState<Awaited<
    ReturnType<typeof linkit.getConversation>
  > | null>(null);
  const [messages, setMessages] = useState<LinkitMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<LinkitAttachment[]>([]);
  const [urgent, setUrgent] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);
  const latestCursorRef = useRef<string | null>(null);

  const scrollToLatest = () => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    setNewMessageCount(0);
  };

  const append = (next: LinkitMessage, forceScroll = false) => {
    setMessages((current) => {
      if (current.some((message) => message.id === next.id)) return current;
      return [...current, next];
    });
    latestCursorRef.current = next.cursor;
    const node = listRef.current;
    const nearLatest = node
      ? node.scrollHeight - node.scrollTop - node.clientHeight < 96
      : true;
    if (forceScroll || nearLatest) requestAnimationFrame(scrollToLatest);
    else setNewMessageCount((count) => count + 1);
  };

  const load = async () => {
    setLoading(true);
    setError("");
    initializedRef.current = false;
    try {
      const [me, detail, page] = await Promise.all([
        linkit.getMe(),
        linkit.getConversation(conversationId),
        linkit.listMessages(conversationId),
      ]);
      setMeId(me.id);
      setConversation(detail);
      setMessages(page.messages);
      setOlderCursor(page.older_cursor ?? null);
      latestCursorRef.current = page.messages.at(-1)?.cursor ?? null;
      await linkit.markConversationRead(conversationId);
    } catch (cause) {
      setConversation(null);
      setMessages([]);
      setOlderCursor(null);
      latestCursorRef.current = null;
      setError(message(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => {
      initializedRef.current = false;
    };
  }, [conversationId, linkit]);

  useLayoutEffect(() => {
    if (loading || initializedRef.current) return;
    initializedRef.current = true;
    requestAnimationFrame(scrollToLatest);
  }, [loading, messages]);

  useEffect(() => {
    if (!conversation) return;
    return linkit.subscribeToConversationMessages(conversationId, (next) => {
      append(next);
      void linkit.markConversationRead(conversationId).catch(() => undefined);
    });
  }, [conversation, conversationId, linkit]);

  useEffect(() => {
    if (!conversation) return;
    const timer = window.setInterval(() => {
      const cursor = latestCursorRef.current;
      if (!cursor) return;
      void linkit
        .listMessages(conversationId, { afterCursor: cursor })
        .then((page) => page.messages.forEach((next) => append(next)))
        .catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [conversation, conversationId, linkit]);

  const loadOlder = async () => {
    if (!olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await linkit.listMessages(conversationId, {
        beforeCursor: olderCursor,
      });
      setMessages((current) => mergeMessages([...page.messages, ...current]));
      setOlderCursor(page.older_cursor ?? null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoadingOlder(false);
    }
  };

  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const attachment = await linkit.upload(file);
      setAttachments((current) => [...current, attachment]);
    } catch (cause) {
      setError(message(cause));
    }
    input.value = "";
  };

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending || (!body.trim() && attachments.length === 0)) return;
    setSending(true);
    setError("");
    try {
      const next = await linkit.sendMessage(conversationId, {
        body,
        attachmentIds: attachments.map((attachment) => attachment.id),
        urgent,
      });
      setBody("");
      setAttachments([]);
      setUrgent(false);
      append(next, true);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSending(false);
    }
  };

  if (loading)
    return (
      <div
        className={clsx(
          "linkit-embedded-conversation linkit-embedded-conversation--loading",
          className,
        )}
        aria-busy="true"
      >
        <LoaderCircle
          className="linkit-embedded-conversation__spinner"
          aria-hidden="true"
        />
        {labels.loading}
      </div>
    );
  if (error && !conversation)
    return (
      <section
        className={clsx(
          "linkit-embedded-conversation linkit-embedded-conversation--error",
          className,
        )}
        role="alert"
      >
        <AlertCircle aria-hidden="true" />
        <div>
          <strong>{labels.unavailable}</strong>
          <p>{error}</p>
          <button
            type="button"
            className="linkit-embedded-conversation__button linkit-embedded-conversation__button--outline"
            onClick={() => void load()}
          >
            {labels.retry}
          </button>
        </div>
      </section>
    );
  if (!conversation) return null;

  return (
    <section
      className={clsx("linkit-embedded-conversation", className)}
      aria-label={
        conversation.kind === "group"
          ? (conversation.title ?? "Group conversation")
          : (conversation.counterpart?.username ??
            conversation.counterpart_name ??
            "Direct conversation")
      }
    >
      <header className="linkit-embedded-conversation__header">
        <LinkitConversationDisplay conversation={conversation} />
        <span className="linkit-embedded-conversation__status">
          {conversation.kind === "group" ? "Group" : "Direct"}
        </span>
      </header>
      {error ? (
        <p className="linkit-embedded-conversation__error" role="alert">
          <TriangleAlert aria-hidden="true" />
          {error}
        </p>
      ) : null}
      <div className="linkit-embedded-conversation__messages" ref={listRef}>
        {olderCursor ? (
          <button
            type="button"
            className="linkit-embedded-conversation__load-older"
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? labels.loadingOlder : labels.loadOlder}
          </button>
        ) : null}
        {messages.length === 0 ? (
          <p className="linkit-embedded-conversation__empty">{labels.empty}</p>
        ) : (
          messages.map((entry) => (
            <MessageBubble
              key={entry.id}
              message={entry}
              mine={entry.sender_kind === "user" && entry.sender_id === meId}
              labels={labels}
              linkit={linkit}
            />
          ))
        )}
      </div>
      {newMessageCount ? (
        <button
          type="button"
          className="linkit-embedded-conversation__new-messages"
          onClick={scrollToLatest}
        >
          {labels.newMessages} ({newMessageCount}){" "}
          <ChevronDown aria-hidden="true" />
        </button>
      ) : null}
      <form className="linkit-embedded-conversation__composer" onSubmit={send}>
        {attachments.length ? (
          <div className="linkit-embedded-conversation__attachments">
            {attachments.map((attachment) => (
              <span key={attachment.id}>
                {attachment.file_name}
                <button
                  type="button"
                  aria-label={`Remove ${attachment.file_name}`}
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter(
                        (candidate) => candidate.id !== attachment.id,
                      ),
                    )
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="linkit-embedded-conversation__composer-row">
          <input
            ref={fileRef}
            className="linkit-embedded-conversation__file"
            type="file"
            onChange={chooseFile}
          />
          <button
            type="button"
            className="linkit-embedded-conversation__icon-button"
            aria-label={labels.attachFile}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip aria-hidden="true" />
          </button>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={labels.writeMessage}
            aria-describedby="linkit-embedded-conversation-hint"
            rows={1}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            type="submit"
            className="linkit-embedded-conversation__button"
            disabled={sending || (!body.trim() && attachments.length === 0)}
          >
            <Send aria-hidden="true" />
            {sending ? labels.sending : labels.send}
          </button>
        </div>
        <label className="linkit-embedded-conversation__urgent">
          <input
            type="checkbox"
            checked={urgent}
            onChange={(event) => setUrgent(event.target.checked)}
          />
          {labels.urgent}
        </label>
        {urgent ? (
          <p className="linkit-embedded-conversation__urgent-notice">
            {labels.urgentNotice}
          </p>
        ) : null}
        <p
          id="linkit-embedded-conversation-hint"
          className="linkit-embedded-conversation__hint"
        >
          {labels.composeHint}
        </p>
      </form>
    </section>
  );
}

function MessageBubble({
  message: entry,
  mine,
  labels,
  linkit,
}: {
  message: LinkitMessage;
  mine: boolean;
  labels: LinkitEmbeddedConversationLabels;
  linkit: ReturnType<typeof useLinkit>;
}) {
  return (
    <article
      className={clsx(
        "linkit-embedded-conversation__message",
        mine && "linkit-embedded-conversation__message--mine",
      )}
    >
      <header>
        <strong>
          {entry.sender_deleted ? labels.deletedBot : entry.sender_name}
        </strong>
        {entry.sender_kind === "bot" ? <span>{labels.bot}</span> : null}
        {entry.urgent ? (
          <span className="linkit-embedded-conversation__urgent-badge">
            {labels.urgent}
          </span>
        ) : null}
        <time dateTime={new Date(entry.created_at * 1000).toISOString()}>
          {new Date(entry.created_at * 1000).toLocaleString()}
        </time>
      </header>
      <div className="linkit-embedded-conversation__bubble">
        {entry.body ? <p>{entry.body}</p> : null}
        {entry.attachments.map((attachment) => (
          <AttachmentLink
            key={attachment.id}
            attachment={attachment}
            labels={labels}
            linkit={linkit}
          />
        ))}
      </div>
    </article>
  );
}

function AttachmentLink({
  attachment,
  labels,
  linkit,
}: {
  attachment: LinkitAttachment;
  labels: LinkitEmbeddedConversationLabels;
  linkit: ReturnType<typeof useLinkit>;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void linkit
      .downloadAttachment(attachment.id)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id, linkit]);
  if (failed)
    return (
      <span className="linkit-embedded-conversation__attachment">
        {attachment.file_name}
      </span>
    );
  if (!url)
    return (
      <span className="linkit-embedded-conversation__attachment">
        {attachment.file_name}
      </span>
    );
  return (
    <a
      className="linkit-embedded-conversation__attachment"
      href={url}
      download={attachment.file_name}
    >
      <FileText aria-hidden="true" />
      {labels.attachmentDownload}: {attachment.file_name}
    </a>
  );
}

function mergeMessages(messages: LinkitMessage[]) {
  const seen = new Set<string>();
  return messages.filter(
    (entry) => !seen.has(entry.id) && (seen.add(entry.id), true),
  );
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
