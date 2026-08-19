export function shouldSendMessageOnEnter({
  key,
  shiftKey,
  isComposing,
}: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}) {
  return key === "Enter" && !shiftKey && !isComposing;
}

export function safeMarkdownUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : "";
  } catch {
    return url.startsWith("/") || url.startsWith("#") ? url : "";
  }
}
