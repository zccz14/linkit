import { AuthMiniButton, useAuthMini } from "auth-mini-react-components";
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { LinkitAvatar } from "./displays.js";
import { useLinkit } from "./linkit-provider.js";
import type { LinkitProfile } from "./types.js";

export type LinkitAppHeaderUserLabels = {
  account: string;
  checking: string;
  signIn: string;
  close: string;
  profile: string;
  profileDescription: string;
  avatar: string;
  uploadAvatar: string;
  username: string;
  displayName: string;
  motto: string;
  uid: string;
  copyUid: string;
  copied: string;
  copyFailed: string;
  save: string;
  saving: string;
  saved: string;
  profileUnavailable: string;
  uploadImageError: string;
  security: string;
  signOut: string;
  signingOut: string;
};

export type LinkitAppHeaderUserProps = {
  lang?: string;
  className?: string;
  loginLabel?: string;
  labels?: Partial<LinkitAppHeaderUserLabels>;
  securitySettingsUrl?: string;
  securitySettingsTarget?: "_blank" | "_self";
  onProfileSaved?: (profile: LinkitProfile) => void;
  onSignedOut?: () => void;
};

const labelsByLanguage: Record<"en" | "zh", LinkitAppHeaderUserLabels> = {
  en: {
    account: "Account",
    checking: "Checking session…",
    signIn: "Sign in",
    close: "Close",
    profile: "Profile",
    profileDescription: "This profile is shown to people who find you through Linkit.",
    avatar: "Avatar",
    uploadAvatar: "Upload image",
    username: "Username",
    displayName: "Display name",
    motto: "Motto",
    uid: "UID",
    copyUid: "Copy UID",
    copied: "UID copied.",
    copyFailed: "Couldn't copy the UID. Select and copy it manually.",
    save: "Save profile",
    saving: "Saving profile…",
    saved: "Profile saved.",
    profileUnavailable: "Your Linkit profile isn't available yet. Add your details and save to create it.",
    uploadImageError: "Choose an image file for your avatar.",
    security: "Account security",
    signOut: "Sign out",
    signingOut: "Signing out…",
  },
  zh: {
    account: "账户",
    checking: "正在检查登录状态…",
    signIn: "登录",
    close: "关闭",
    profile: "个人资料",
    profileDescription: "这份资料会展示给通过 Linkit 找到你的人。",
    avatar: "头像",
    uploadAvatar: "上传图片",
    username: "用户名",
    displayName: "昵称",
    motto: "格言",
    uid: "UID",
    copyUid: "复制 UID",
    copied: "UID 已复制。",
    copyFailed: "无法复制 UID。请手动选择并复制。",
    save: "保存资料",
    saving: "正在保存资料…",
    saved: "个人资料已保存。",
    profileUnavailable: "你的 Linkit 资料尚不可用。填写资料并保存即可创建。",
    uploadImageError: "请为头像选择图片文件。",
    security: "账户与安全",
    signOut: "退出登录",
    signingOut: "正在退出登录…",
  },
};

type Editor = { username: string; displayName: string; motto: string; avatarAttachmentId: string };

export function LinkitAppHeaderUser({
  lang = "en",
  className,
  loginLabel,
  labels: labelOverrides,
  securitySettingsUrl,
  securitySettingsTarget,
  onProfileSaved,
  onSignedOut,
}: LinkitAppHeaderUserProps) {
  const auth = useAuthMini();
  const linkit = useLinkit();
  const labels = useMemo(() => ({ ...labelsByLanguage[languageKey(lang)], ...labelOverrides }), [lang, labelOverrides]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<LinkitProfile | null>(null);
  const [editor, setEditor] = useState<Editor>(emptyEditor);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const authenticated = auth.isAuthenticated;
  const uid = profile?.user_id ?? null;

  useEffect(() => {
    if (!authenticated) {
      setProfile(null);
      setEditor(emptyEditor());
      setAvatarPreview(null);
      return;
    }
    void refreshProfile();
  // Refresh only as the authentication boundary changes. The Linkit context functions are stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  useEffect(() => () => {
    if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  const dirty = !profile
    ? Boolean(editor.username || editor.displayName || editor.motto || editor.avatarAttachmentId)
    : editor.username !== profile.username
      || editor.displayName !== profile.display_name
      || editor.motto !== (profile.motto ?? "")
      || editor.avatarAttachmentId !== (profile.avatar_attachment_id ?? "");

  async function refreshProfile() {
    setLoading(true);
    setError(null);
    try {
      const me = await linkit.getMe();
      let publicProfile: LinkitProfile | null = null;
      try {
        publicProfile = await linkit.getProfile(me.id);
      } catch {
        // A new profile has no public record yet; its editable private shape still comes from /api/me.
      }
      const next = me.profile ? { ...me.profile, avatar_url: publicProfile?.avatar_url ?? null } : null;
      setProfile(next);
      setEditor(toEditor(next));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
    }
  }

  function openDialog() {
    setError(null);
    setNotice(null);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  async function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(labels.uploadImageError);
      return;
    }
    setError(null);
    try {
      const attachment = await linkit.upload(file);
      if (!attachment.media_type.startsWith("image/")) throw new Error(labels.uploadImageError);
      if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(URL.createObjectURL(file));
      setEditor((current) => ({ ...current, avatarAttachmentId: attachment.id }));
    } catch (cause) {
      setError(message(cause));
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const saved = await linkit.updateProfile({
        username: editor.username.trim(),
        display_name: editor.displayName.trim(),
        motto: editor.motto.trim(),
        avatar_attachment_id: editor.avatarAttachmentId || undefined,
      });
      const publicProfile = await linkit.getProfile(saved.user_id).catch(() => null);
      const next = { ...saved, avatar_url: publicProfile?.avatar_url ?? avatarPreview ?? null };
      setProfile(next);
      setEditor(toEditor(next));
      setNotice(labels.saved);
      onProfileSaved?.(next);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  }

  async function copyUid() {
    if (!uid) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(uid);
      setNotice(labels.copied);
    } catch {
      setError(labels.copyFailed);
    }
  }

  async function signOut() {
    setSigningOut(true);
    setError(null);
    try {
      await auth.signOut();
      closeDialog();
      onSignedOut?.();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSigningOut(false);
    }
  }

  if (!auth.isReady) return <span aria-live="polite" className={className}>{labels.checking}</span>;
  if (!authenticated) {
    return <button className={className} type="button" onClick={auth.signIn}>{loginLabel ?? labels.signIn}</button>;
  }

  const displayName = profile?.display_name?.trim() || profile?.username?.trim() || labels.account;
  const avatarProfile = avatarPreview ? { display_name: displayName, avatar_url: avatarPreview } : profile;
  return <>
    <button aria-haspopup="dialog" className={className} type="button" onClick={openDialog}>
      <LinkitAvatar profile={avatarProfile} size="sm" fallback={displayName} />
      <span className="linkit-app-header-user__name">{displayName}</span>
    </button>
    <dialog aria-describedby={descriptionId} aria-labelledby={titleId} className="linkit-app-header-user__dialog" ref={dialogRef}>
      <div className="linkit-app-header-user__surface">
        <header className="linkit-app-header-user__dialog-header">
          <div>
            <h2 id={titleId}>{labels.profile}</h2>
            <p id={descriptionId}>{labels.profileDescription}</p>
          </div>
          <button aria-label={labels.close} className="linkit-app-header-user__icon-button" type="button" onClick={closeDialog}>×</button>
        </header>
        {loading ? <p aria-live="polite" className="linkit-app-header-user__status">{labels.checking}</p> : null}
        {!loading && !profile ? <p className="linkit-app-header-user__hint">{labels.profileUnavailable}</p> : null}
        {error ? <p aria-live="assertive" className="linkit-app-header-user__error">{error}</p> : null}
        {notice ? <p aria-live="polite" className="linkit-app-header-user__notice">{notice}</p> : null}
        <form aria-busy={saving} className="linkit-app-header-user__form" onSubmit={(event) => void saveProfile(event)}>
          <div className="linkit-app-header-user__avatar-row">
            <LinkitAvatar profile={avatarProfile} fallback={displayName} size="lg" />
            <div>
              <span className="linkit-app-header-user__label">{labels.avatar}</span>
              <input accept="image/*" className="linkit-app-header-user__visually-hidden" ref={fileRef} type="file" onChange={(event) => void chooseAvatar(event)} />
              <button className="linkit-app-header-user__secondary-button" type="button" onClick={() => fileRef.current?.click()}>{labels.uploadAvatar}</button>
            </div>
          </div>
          <label><span>{labels.username}</span><input autoComplete="username" maxLength={32} required value={editor.username} onChange={(event) => setEditor((current) => ({ ...current, username: event.target.value }))} /></label>
          <label><span>{labels.displayName}</span><input maxLength={80} required value={editor.displayName} onChange={(event) => setEditor((current) => ({ ...current, displayName: event.target.value }))} /></label>
          <label><span>{labels.motto}</span><textarea maxLength={280} rows={3} value={editor.motto} onChange={(event) => setEditor((current) => ({ ...current, motto: event.target.value }))} /></label>
          <div className="linkit-app-header-user__uid"><span>{labels.uid}</span><code>{uid ?? "—"}</code><button disabled={!uid} type="button" onClick={() => void copyUid()}>{labels.copyUid}</button></div>
          <div className="linkit-app-header-user__actions">
            <button className="linkit-app-header-user__primary-button" disabled={saving || !dirty} type="submit">{saving ? labels.saving : labels.save}</button>
            <AuthMiniButton lang={lang} securitySettingsTarget={securitySettingsTarget} securitySettingsUrl={securitySettingsUrl} size="sm" variant="outline" labels={{ signedIn: labels.security }} />
            <button className="linkit-app-header-user__danger-button" disabled={signingOut} type="button" onClick={() => void signOut()}>{signingOut ? labels.signingOut : labels.signOut}</button>
          </div>
        </form>
      </div>
    </dialog>
  </>;
}

function emptyEditor(): Editor { return { username: "", displayName: "", motto: "", avatarAttachmentId: "" }; }
function toEditor(profile: LinkitProfile | null): Editor { return { username: profile?.username ?? "", displayName: profile?.display_name ?? "", motto: profile?.motto ?? "", avatarAttachmentId: profile?.avatar_attachment_id ?? "" }; }
function languageKey(lang: string): "en" | "zh" { const normalized = lang.toLowerCase(); return normalized === "zh" || normalized.startsWith("zh-") ? "zh" : "en"; }
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
