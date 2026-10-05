import type { MessageMention } from "./api.ts";

export type MentionToken = {
  start: number;
  query: string;
};

export type MentionCandidate = {
  user_id: string;
  username: string;
  user_type: "human" | "bot";
  has_profile: boolean;
};

export type MessageTextSegment = {
  text: string;
  username: string | null;
};

const usernameMaxLength = 80;
const mentionTokenPattern =
  /<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;

/// The `@…` token the caret is writing, or null while the caret is not in one. The `@`
/// must not continue an ASCII handle, so email addresses never open the picker.
export function activeMentionToken(
  value: string,
  caret: number,
): MentionToken | null {
  const start = value.lastIndexOf("@", caret - 1);
  if (start < 0) return null;
  const query = value.slice(start + 1, caret);
  if (query.length > usernameMaxLength || query.includes("\n")) return null;
  if (isHandlePrefix(previousCharacter(value, start))) return null;
  return { start, query };
}

/// Replaces the active token with `@username`, so the mention is separated from the
/// text around it by exactly one space.
export function applyMention(
  value: string,
  token: MentionToken,
  username: string,
) {
  const caret = token.start + 1 + token.query.length;
  const separator = value[caret] === " " ? "" : " ";
  return {
    value: `${value.slice(0, token.start)}@${username}${separator}${value.slice(caret)}`,
    caret: token.start + username.length + 1 + separator.length,
  };
}

/// Members the composer can suggest for the current token: profiled members and bots,
/// other than the sender. The query fuzzy-matches the username and the viewer's note
/// name (case-insensitive substring).
export function mentionCandidates(
  members: MentionCandidate[],
  query: string,
  selfId: string,
  noteNames: ReadonlyMap<string, string>,
): MentionCandidate[] {
  const needle = asciiLowercase(query.trim());
  return members.filter(
    (member) =>
      (member.has_profile || member.user_type === "bot") &&
      member.user_id !== selfId &&
      [member.username, noteNames.get(member.user_id) ?? ""].some((name) =>
        asciiLowercase(name).includes(needle),
      ),
  );
}

/// Replaces every typed `@username` that names a composer candidate with the canonical
/// `<@user_id>` token, so the message body stores mentions in the token format.
export function tokenizeMentions(
  text: string,
  members: MentionCandidate[],
): string {
  const characters = Array.from(text);
  const names = members.map((member) => ({
    member,
    characters: Array.from(member.username),
  }));
  let tokenized = "";
  let index = 0;
  while (index < characters.length) {
    const previous = index > 0 ? characters[index - 1] : "";
    if (characters[index] === "@" && !isHandlePrefix(previous)) {
      const matched = longestMentionAt(characters, index + 1, names);
      if (matched) {
        tokenized += `<@${matched.member.user_id}>`;
        index += 1 + matched.characters.length;
        continue;
      }
    }
    tokenized += characters[index];
    index += 1;
  }
  return tokenized;
}

/// Splits message text into plain and mention segments for rendering: only tokens whose
/// user ID is one of the message's mentions become `@username`, everything else
/// (including other token-shaped text) stays as written.
export function splitMentionTokens(
  text: string,
  mentions: MessageMention[],
): MessageTextSegment[] {
  const segments: MessageTextSegment[] = [];
  let copied = 0;
  for (const match of text.matchAll(mentionTokenPattern)) {
    const mention = findMention(mentions, match[1]);
    if (!mention) continue;
    const index = match.index ?? 0;
    if (index > copied)
      segments.push({ text: text.slice(copied, index), username: null });
    segments.push({ text: `@${mention.username}`, username: mention.username });
    copied = index + match[0].length;
  }
  if (copied < text.length)
    segments.push({ text: text.slice(copied), username: null });
  return segments;
}

/// `splitMentionTokens` as plain text, for code spans and other non-styled surfaces.
export function replaceMentionTokens(
  text: string,
  mentions: MessageMention[],
): string {
  return splitMentionTokens(text, mentions)
    .map((segment) => segment.text)
    .join("");
}

type MentionName = { member: MentionCandidate; characters: string[] };

function findMention(mentions: MessageMention[], id: string) {
  const normalized = id.toLowerCase();
  return mentions.find(
    (mention) => mention.user_id.toLowerCase() === normalized,
  );
}

function longestMentionAt(
  characters: string[],
  start: number,
  names: MentionName[],
): MentionName | null {
  let longest: MentionName | null = null;
  for (const name of names) {
    if (longest && name.characters.length <= longest.characters.length)
      continue;
    if (matchesUsernameAt(characters, start, name.characters)) longest = name;
  }
  return longest;
}

function matchesUsernameAt(
  characters: string[],
  start: number,
  username: string[],
) {
  if (start + username.length > characters.length) return false;
  for (let offset = 0; offset < username.length; offset += 1) {
    if (
      !sameCharacterIgnoringAsciiCase(
        characters[start + offset],
        username[offset],
      )
    )
      return false;
  }
  const next = characters[start + username.length];
  return next === undefined || !isHandleContinuation(next);
}

function previousCharacter(value: string, index: number) {
  return Array.from(value.slice(0, index)).pop() ?? "";
}

function sameCharacterIgnoringAsciiCase(left: string, right: string) {
  return left === right || asciiLowercase(left) === asciiLowercase(right);
}

/// Usernames only match ASCII case-insensitively, mirroring the `COLLATE NOCASE`
/// usernames stored by Linkit.
function asciiLowercase(value: string) {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function isHandleContinuation(character: string) {
  return /[\p{L}\p{N}_-]/u.test(character);
}

/// An `@` right after an ASCII handle character (an email address) never starts a
/// mention token.
function isHandlePrefix(character: string) {
  return /^[0-9A-Za-z_-]$/.test(character);
}
