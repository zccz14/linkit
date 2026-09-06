import { useAuthMini } from "auth-mini-react-components";
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { CheckIcon, CopyIcon, KeyRoundIcon, LoaderCircleIcon, LogOutIcon, SettingsIcon, UploadIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useLinkit } from "./linkit-provider.js";
import type { LinkitProfile } from "./types.js";

type LinkitMyInfoLabels = {
  account: string;
  checking: string;
  signIn: string;
  close: string;
  profile: string;
  profileDescription: string;
  avatar: string;
  uploadAvatar: string;
  username: string;
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
  securityDescription: string;
  addPasskey: string;
  manageSignInMethods: string;
  signOut: string;
  signingOut: string;
};

const labelsByLanguage: Record<"en" | "zh", LinkitMyInfoLabels> = {
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
    securityDescription: "Manage passkeys and sign-in methods with Auth Mini.",
    addPasskey: "Add passkey",
    manageSignInMethods: "Manage sign-in methods",
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
    securityDescription: "使用 Auth Mini 管理通行密钥和登录方式。",
    addPasskey: "添加通行密钥",
    manageSignInMethods: "管理登录方式",
    signOut: "退出登录",
    signingOut: "正在退出登录…",
  },
};

type Editor = { username: string; motto: string; avatarAttachmentId: string };

export function LinkitMyInfo() {
  const auth = useAuthMini();
  const {
    lang,
    myProfile: profile,
    myProfileError,
    myProfileLoading: loading,
    myUserId: userId,
    refreshMyProfile,
    saveMyProfile,
    signOut: signOutFromLinkit,
    upload,
  } = useLinkit();
  const labels = labelsByLanguage[languageKey(lang)];
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<Editor>(emptyEditor);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const uid = profile?.user_id ?? userId;

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setOpen(false);
      setEditor(emptyEditor());
      setAvatarPreview(null);
    }
  }, [auth.isAuthenticated]);

  useEffect(() => {
    void refreshMyProfile();
  }, [refreshMyProfile]);

  useEffect(() => {
    setEditor(toEditor(profile));
  }, [profile]);

  useEffect(() => () => {
    if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  const dirty = !profile
    ? Boolean(editor.username || editor.motto || editor.avatarAttachmentId)
    : editor.username !== profile.username
      || editor.motto !== (profile.motto ?? "")
      || editor.avatarAttachmentId !== (profile.avatar_attachment_id ?? "");

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
      const attachment = await upload(file);
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
      const saved = await saveMyProfile({
        username: editor.username.trim(),
        motto: editor.motto.trim(),
        avatar_attachment_id: editor.avatarAttachmentId || undefined,
      });
      setEditor(toEditor(saved));
      setAvatarPreview(null);
      setNotice(labels.saved);
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
      await signOutFromLinkit();
      setOpen(false);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSigningOut(false);
    }
  }

  if (!auth.isReady) return <span aria-live="polite" className="linkit-my-info">{labels.checking}</span>;
  if (!auth.isAuthenticated) {
    return <ButtonPrimitive className="linkit-my-info" type="button" onClick={auth.signIn}>{labels.signIn}</ButtonPrimitive>;
  }

  const username = profile?.username?.trim() || labels.account;
  const avatarProfile = avatarPreview ? { username, avatar_url: avatarPreview } : profile;
  const securityUrl = authMiniSecurityUrl(auth.authMiniBaseUrl);
  return <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
    <DialogPrimitive.Trigger render={<ButtonPrimitive aria-haspopup="dialog" className="linkit-my-info" type="button" />}>
      <HeaderAvatar profile={avatarProfile} label={username} />
      <span className="linkit-my-info__name">{username}</span>
    </DialogPrimitive.Trigger>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="linkit-my-info__backdrop" />
      <DialogPrimitive.Popup aria-describedby={descriptionId} aria-labelledby={titleId} className="linkit-my-info__dialog">
        <header className="linkit-my-info__dialog-header">
          <div>
            <DialogPrimitive.Title id={titleId}>{labels.account}</DialogPrimitive.Title>
            <DialogPrimitive.Description id={descriptionId}>{labels.profileDescription}</DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close render={<ButtonPrimitive aria-label={labels.close} className="linkit-my-info__icon-button" type="button" />}>
            <XIcon />
          </DialogPrimitive.Close>
        </header>
        {loading ? <LoadingSkeleton labels={labels} /> : null}
        {!loading && !profile ? <Alert>{labels.profileUnavailable}</Alert> : null}
        {error || myProfileError || auth.error ? <Alert variant="destructive">{error ?? myProfileError ?? auth.error?.message}</Alert> : null}
        {notice ? <Alert variant="success"><CheckIcon />{notice}</Alert> : null}
        <form aria-busy={saving} className="linkit-my-info__form" onSubmit={(event) => void saveProfile(event)}>
          <section aria-labelledby={`${titleId}-profile`} className="linkit-my-info__section">
            <h3 id={`${titleId}-profile`}>{labels.profile}</h3>
            <div className="linkit-my-info__field-group">
              <div className="linkit-my-info__field">
                <span className="linkit-my-info__field-label">{labels.avatar}</span>
                <div className="linkit-my-info__avatar-row">
                  <HeaderAvatar profile={avatarProfile} label={username} size="lg" />
                  <input accept="image/*" className="linkit-my-info__visually-hidden" ref={fileRef} type="file" onChange={(event) => void chooseAvatar(event)} />
                  <ButtonPrimitive className="linkit-my-info__button linkit-my-info__button--outline" type="button" onClick={() => fileRef.current?.click()}>
                    <UploadIcon data-icon="inline-start" />{labels.uploadAvatar}
                  </ButtonPrimitive>
                </div>
              </div>
              <label className="linkit-my-info__field" htmlFor={`${titleId}-username`}><span>{labels.username}</span><input autoComplete="username" id={`${titleId}-username`} maxLength={80} required value={editor.username} onChange={(event) => setEditor((current) => ({ ...current, username: event.target.value }))} /></label>
              <label className="linkit-my-info__field" htmlFor={`${titleId}-motto`}><span>{labels.motto}</span><textarea id={`${titleId}-motto`} maxLength={280} rows={3} value={editor.motto} onChange={(event) => setEditor((current) => ({ ...current, motto: event.target.value }))} /></label>
            </div>
          </section>
          <SeparatorPrimitive className="linkit-my-info__separator" />
          <section aria-labelledby={`${titleId}-security`} className="linkit-my-info__section">
            <h3 id={`${titleId}-security`}>{labels.security}</h3>
            <p>{labels.securityDescription}</p>
            <div className="linkit-my-info__uid"><span>{labels.uid}</span><code>{uid ?? "—"}</code><ButtonPrimitive aria-label={labels.copyUid} className="linkit-my-info__icon-button" disabled={!uid} title={labels.copyUid} type="button" onClick={() => void copyUid()}><CopyIcon /></ButtonPrimitive></div>
            <div className="linkit-my-info__security-actions">
              <ButtonPrimitive className="linkit-my-info__button linkit-my-info__button--outline" type="button" onClick={() => auth.openPasskeyRegistrationPage()}><KeyRoundIcon data-icon="inline-start" />{labels.addPasskey}</ButtonPrimitive>
              <a className="linkit-my-info__button linkit-my-info__button--outline" href={securityUrl} rel="noreferrer" target="_blank"><SettingsIcon data-icon="inline-start" />{labels.manageSignInMethods}</a>
            </div>
          </section>
          <footer className="linkit-my-info__footer">
            <ButtonPrimitive className="linkit-my-info__button" disabled={saving || !dirty} type="submit">{saving ? <><LoaderCircleIcon className="linkit-my-info__spinner" data-icon="inline-start" />{labels.saving}</> : labels.save}</ButtonPrimitive>
            <ButtonPrimitive className="linkit-my-info__button linkit-my-info__button--destructive" disabled={signingOut} type="button" onClick={() => void signOut()}>{signingOut ? <><LoaderCircleIcon className="linkit-my-info__spinner" data-icon="inline-start" />{labels.signingOut}</> : <><LogOutIcon data-icon="inline-start" />{labels.signOut}</>}</ButtonPrimitive>
          </footer>
        </form>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

function HeaderAvatar({ profile, label, size = "sm" }: { profile: Pick<LinkitProfile, "username" | "avatar_url"> | null | undefined; label: string; size?: "sm" | "lg" }) {
  return <AvatarPrimitive.Root className="linkit-my-info__avatar" data-size={size}>
    {profile?.avatar_url ? <AvatarPrimitive.Image alt="" className="linkit-my-info__avatar-image" src={profile.avatar_url} /> : null}
    <AvatarPrimitive.Fallback className="linkit-my-info__avatar-fallback">{Array.from(label)[0]?.toLocaleUpperCase() ?? "?"}</AvatarPrimitive.Fallback>
  </AvatarPrimitive.Root>;
}

function LoadingSkeleton({ labels }: { labels: LinkitMyInfoLabels }) {
  return <div aria-label={labels.checking} aria-live="polite" className="linkit-my-info__skeletons" role="status"><span /><span /><span /></div>;
}

function Alert({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "destructive" | "success" }) {
  return <div className="linkit-my-info__alert" data-variant={variant} role={variant === "destructive" ? "alert" : "status"}>{children}</div>;
}

function emptyEditor(): Editor { return { username: "", motto: "", avatarAttachmentId: "" }; }
function toEditor(profile: LinkitProfile | null): Editor { return { username: profile?.username ?? "", motto: profile?.motto ?? "", avatarAttachmentId: profile?.avatar_attachment_id ?? "" }; }
function languageKey(lang: string): "en" | "zh" { const normalized = lang.toLowerCase(); return normalized === "zh" || normalized.startsWith("zh-") ? "zh" : "en"; }
function authMiniSecurityUrl(authMiniBaseUrl: string) { const url = new URL("/web/", authMiniBaseUrl); url.hash = "/"; return url.toString(); }
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
