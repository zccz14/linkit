import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { CircleAlertIcon, LoaderCircleIcon, MessageCircleIcon, PencilIcon, Trash2Icon, UserRoundIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { LinkitProfile } from "./types.js";
import { useLinkitUserInfo } from "./linkit-provider.js";

export type LinkitUserInfoProps = {
  userId: string;
  compact?: boolean;
};

export function LinkitUserInfo({ userId, compact = false }: LinkitUserInfoProps) {
  const titleId = useId();
  const descriptionId = useId();
  const {
    copy,
    deleteNote,
    loading,
    note,
    noteLoading,
    notesEnabled,
    openDirectConversation,
    profile,
    saveNote: saveNoteRequest,
  } = useLinkitUserInfo(userId);
  const [open, setOpen] = useState(false);
  const [directing, setDirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteName, setNoteName] = useState("");
  const [editingNote, setEditingNote] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const noteNameRef = useRef("");
  const editingNoteRef = useRef(false);
  const savingNoteRef = useRef(false);
  const blurSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const username = profile?.username?.trim() || "";
  const displayName = note?.name || username || copy.unknownUser;

  useEffect(() => {
    const nextName = note?.name ?? "";
    noteNameRef.current = nextName;
    setNoteName(nextName);
    editingNoteRef.current = false;
    setEditingNote(false);
    setNoteError(null);
  }, [note?.name, userId]);

  useEffect(() => () => {
    if (blurSaveTimer.current) clearTimeout(blurSaveTimer.current);
  }, []);

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

  async function saveNote() {
    if (!editingNoteRef.current || savingNoteRef.current) return;
    const nextName = noteNameRef.current.trim();
    savingNoteRef.current = true;
    setSavingNote(true);
    setNoteError(null);
    try {
      if (nextName) {
        const saved = await saveNoteRequest(nextName);
        noteNameRef.current = saved.name;
        setNoteName(saved.name);
      } else if (note) {
        await deleteNote();
        noteNameRef.current = "";
        setNoteName("");
      }
      editingNoteRef.current = false;
      setEditingNote(false);
    } catch (cause) {
      setNoteError(message(cause));
    } finally {
      savingNoteRef.current = false;
      setSavingNote(false);
    }
  }

  async function removeNote() {
    if (savingNoteRef.current) return;
    savingNoteRef.current = true;
    setSavingNote(true);
    setNoteError(null);
    try {
      await deleteNote();
      noteNameRef.current = "";
      setNoteName("");
    } catch (cause) {
      setNoteError(message(cause));
    } finally {
      savingNoteRef.current = false;
      setSavingNote(false);
    }
  }

  function beginNoteEdit() {
    const nextName = note?.name ?? "";
    noteNameRef.current = nextName;
    setNoteName(nextName);
    editingNoteRef.current = true;
    setEditingNote(true);
    setNoteError(null);
  }

  function cancelNoteEdit() {
    if (blurSaveTimer.current) clearTimeout(blurSaveTimer.current);
    blurSaveTimer.current = undefined;
    const nextName = note?.name ?? "";
    noteNameRef.current = nextName;
    setNoteName(nextName);
    editingNoteRef.current = false;
    setEditingNote(false);
    setNoteError(null);
  }

  function scheduleBlurSave() {
    if (blurSaveTimer.current || savingNoteRef.current) return;
    blurSaveTimer.current = setTimeout(() => {
      blurSaveTimer.current = undefined;
      void saveNote();
    });
  }

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blurSaveTimer.current) clearTimeout(blurSaveTimer.current);
    blurSaveTimer.current = undefined;
    void saveNote();
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
              {editingNote ? <form className="linkit-user-info__note-editor" onSubmit={submitNote}>
                <input
                  aria-label={copy.privateNote}
                  autoFocus
                  disabled={noteLoading || savingNote}
                  maxLength={80}
                  placeholder={copy.privateNotePlaceholder}
                  value={noteName}
                  onBlur={scheduleBlurSave}
                  onChange={(event) => {
                    noteNameRef.current = event.target.value;
                    setNoteName(event.target.value);
                  }}
                />
                <ButtonPrimitive aria-label={copy.cancelNote} className="linkit-user-info__note-icon" disabled={savingNote} title={copy.cancelNote} type="button" onClick={cancelNoteEdit}>
                  <XIcon aria-hidden="true" />
                </ButtonPrimitive>
                {savingNote ? <LoaderCircleIcon aria-label={copy.savingNote} className="linkit-user-info__spinner" /> : null}
              </form> : <div className="linkit-user-info__detail-name-row">
                <p className="linkit-user-info__detail-username">{displayName}</p>
                {notesEnabled ? <ButtonPrimitive aria-label={copy.editNote} className="linkit-user-info__note-icon" disabled={noteLoading || savingNote} title={copy.editNote} type="button" onClick={beginNoteEdit}>
                  <PencilIcon aria-hidden="true" />
                </ButtonPrimitive> : null}
                {notesEnabled && note ? <ButtonPrimitive aria-label={copy.removeNote} className="linkit-user-info__note-icon linkit-user-info__note-icon--destructive" disabled={noteLoading || savingNote} title={copy.removeNote} type="button" onClick={() => void removeNote()}>
                  <Trash2Icon aria-hidden="true" />
                </ButtonPrimitive> : null}
              </div>}
              <code className="linkit-user-info__detail-id">{userId}</code>
            </div>
          </div>
          <SeparatorPrimitive className="linkit-user-info__separator" />
          {loading ? <div aria-label={copy.userInformation} className="linkit-user-info__skeleton" role="status"><span /><span /></div> : null}
          {!loading && !username ? <InfoAlert>{copy.profileUnavailable}</InfoAlert> : null}
          {profile?.intro ? <p className="linkit-user-info__intro">{profile.intro}</p> : null}
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
