import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { CircleAlertIcon, LoaderCircleIcon, MessageCircleIcon, UserRoundIcon } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { LinkitProfile } from "./types.js";
import { useLinkitUserInfo } from "./linkit-provider.js";

export type LinkitUserInfoProps = {
  userId: string;
  compact?: boolean;
};

export function LinkitUserInfo({ userId, compact = false }: LinkitUserInfoProps) {
  const titleId = useId();
  const descriptionId = useId();
  const noteInputId = useId();
  const {
    copy,
    deleteNote,
    loading,
    note,
    noteLoading,
    notesEnabled,
    openDirectConversation,
    profile,
    saveNote,
  } = useLinkitUserInfo(userId);
  const [open, setOpen] = useState(false);
  const [directing, setDirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteName, setNoteName] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const username = profile?.username?.trim() || "";
  const displayName = note?.name || username || copy.unknownUser;

  useEffect(() => {
    setNoteName(note?.name ?? "");
    setNoteError(null);
  }, [note?.name, userId]);

  async function openDirectMessage() {
    if (!username) return;
    setDirecting(true);
    setError(null);
    try {
      await openDirectConversation(userId, username);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setDirecting(false);
    }
  }

  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingNote(true);
    setNoteError(null);
    try {
      const saved = await saveNote(noteName);
      setNoteName(saved.name);
    } catch (cause) {
      setNoteError(message(cause));
    } finally {
      setSavingNote(false);
    }
  }

  async function removeNote() {
    setSavingNote(true);
    setNoteError(null);
    try {
      await deleteNote();
      setNoteName("");
    } catch (cause) {
      setNoteError(message(cause));
    } finally {
      setSavingNote(false);
    }
  }

  return <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
    <PopoverPrimitive.Trigger
      aria-label={`${copy.userInformation}: ${displayName}, ${userId}`}
      className={compact ? "linkit-user-info linkit-user-info--compact" : "linkit-user-info"}
      openOnHover
      delay={180}
      closeDelay={160}
      type="button"
    >
      <UserAvatar profile={profile} label={displayName} compact={compact} />
      <span className="linkit-user-info__copy">
        <span className="linkit-user-info__username" title={displayName}>{displayName}</span>
        <code className="linkit-user-info__id" title={userId}>{userId}</code>
      </span>
    </PopoverPrimitive.Trigger>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner align="start" side="bottom" sideOffset={8}>
        <PopoverPrimitive.Popup aria-describedby={descriptionId} aria-labelledby={titleId} className="linkit-user-info__popup" initialFocus={false}>
          <PopoverPrimitive.Title id={titleId}>{copy.userInformation}</PopoverPrimitive.Title>
          <PopoverPrimitive.Description id={descriptionId} className="linkit-user-info__visually-hidden">{displayName}</PopoverPrimitive.Description>
          <div className="linkit-user-info__detail">
            <UserAvatar profile={profile} label={displayName} large />
            <div className="linkit-user-info__detail-copy">
              <p className="linkit-user-info__detail-username">{displayName}</p>
              <code className="linkit-user-info__detail-id">{userId}</code>
            </div>
          </div>
          <SeparatorPrimitive className="linkit-user-info__separator" />
          {loading ? <div aria-label={copy.userInformation} className="linkit-user-info__skeleton" role="status"><span /><span /></div> : null}
          {!loading && !username ? <InfoAlert>{copy.profileUnavailable}</InfoAlert> : null}
          {profile?.intro ? <p className="linkit-user-info__intro">{profile.intro}</p> : null}
          {notesEnabled ? <form className="linkit-user-info__note" onSubmit={(event) => void submitNote(event)}>
            <label htmlFor={noteInputId}>
              <span>{copy.privateNote}</span>
              <input
                disabled={noteLoading || savingNote}
                id={noteInputId}
                maxLength={80}
                placeholder={copy.privateNotePlaceholder}
                value={noteName}
                onChange={(event) => setNoteName(event.target.value)}
              />
            </label>
            <p>{copy.privateNoteHint}</p>
            <div className="linkit-user-info__note-actions">
              <ButtonPrimitive className="linkit-user-info__note-save" disabled={noteLoading || savingNote || !noteName.trim() || noteName.trim() === (note?.name ?? "")} type="submit">
                {savingNote ? <LoaderCircleIcon className="linkit-user-info__spinner" data-icon="inline-start" /> : null}
                {savingNote ? copy.savingNote : copy.saveNote}
              </ButtonPrimitive>
              {note ? <ButtonPrimitive className="linkit-user-info__note-remove" disabled={savingNote} type="button" onClick={() => void removeNote()}>{copy.removeNote}</ButtonPrimitive> : null}
            </div>
          </form> : null}
          {error ? <InfoAlert destructive><CircleAlertIcon aria-hidden="true" />{error}</InfoAlert> : null}
          {noteError ? <InfoAlert destructive><CircleAlertIcon aria-hidden="true" />{noteError}</InfoAlert> : null}
          <ButtonPrimitive className="linkit-user-info__dm" disabled={!username || directing} type="button" onClick={() => void openDirectMessage()}>
            {directing ? <LoaderCircleIcon className="linkit-user-info__spinner" data-icon="inline-start" /> : <MessageCircleIcon data-icon="inline-start" />}
            {directing ? copy.openingDirectMessage : copy.directMessage}
          </ButtonPrimitive>
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>;
}

function UserAvatar({ profile, label, compact = false, large = false }: { profile: LinkitProfile | null; label: string; compact?: boolean; large?: boolean }) {
  return <AvatarPrimitive.Root aria-label={label} className="linkit-user-info__avatar" data-compact={compact || undefined} data-large={large || undefined}>
    {profile?.avatar_url ? <AvatarPrimitive.Image alt="" className="linkit-user-info__avatar-image" src={profile.avatar_url} /> : null}
    <AvatarPrimitive.Fallback className="linkit-user-info__avatar-fallback"><UserRoundIcon aria-hidden="true" /></AvatarPrimitive.Fallback>
  </AvatarPrimitive.Root>;
}

function InfoAlert({ children, destructive = false }: { children: React.ReactNode; destructive?: boolean }) {
  return <div className="linkit-user-info__alert" data-destructive={destructive || undefined} role={destructive ? "alert" : "status"}>{children}</div>;
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
