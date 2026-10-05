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

/// Members the composer can suggest for the current token: members with a profile,
/// other than the sender, whose username starts with what was typed so far.
export function mentionCandidates(
  members: MentionCandidate[],
  query: string,
  selfId: string,
): MentionCandidate[] {
  const prefix = asciiLowercase(query);
  return members.filter(
    (member) =>
      member.has_profile &&
      member.user_id !== selfId &&
      asciiLowercase(member.username).startsWith(prefix),
  );
}

/// Splits message text into plain and mention segments, mirroring the server rules:
/// the longest member username after `@` wins, it must not continue into more handle
/// characters, and an ASCII handle glued to `@` is not a mention.
export function splitMentions(
  text: string,
  usernames: string[],
): MessageTextSegment[] {
  const characters = Array.from(text);
  const names = usernames.map((username) => Array.from(username));
  const segments: MessageTextSegment[] = [];
  let plain = "";
  let index = 0;
  while (index < characters.length) {
    const previous = index > 0 ? characters[index - 1] : "";
    if (characters[index] === "@" && !isHandlePrefix(previous)) {
      const matched = longestMentionAt(characters, index + 1, names);
      if (matched) {
        if (plain) segments.push({ text: plain, username: null });
        plain = "";
        segments.push({
          text: characters.slice(index, index + 1 + matched.length).join(""),
          username: matched.join(""),
        });
        index += 1 + matched.length;
        continue;
      }
    }
    plain += characters[index];
    index += 1;
  }
  if (plain) segments.push({ text: plain, username: null });
  return segments;
}

function longestMentionAt(
  characters: string[],
  start: number,
  usernames: string[][],
): string[] | null {
  let longest: string[] | null = null;
  for (const username of usernames) {
    if (longest && username.length <= longest.length) continue;
    if (matchesUsernameAt(characters, start, username)) longest = username;
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

function asciiLowercase(value: string) {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

/// Usernames only match ASCII case-insensitively, mirroring the `COLLATE NOCASE`
/// usernames stored by Linkit.
function isHandleContinuation(character: string) {
  return /[\p{L}\p{N}_-]/u.test(character);
}

/// An `@` right after an ASCII handle character (an email address) never starts a
/// mention token.
function isHandlePrefix(character: string) {
  return /^[0-9A-Za-z_-]$/.test(character);
}
