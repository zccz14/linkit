import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { LinkitAvatar } from "./displays.js";
import { useLinkit } from "./linkit-provider.js";
import type { LinkitUserSearchResult } from "./types.js";

export type LinkitUserPickerLabels = {
  label: string;
  placeholder: string;
  clear: string;
  loading: string;
  empty: string;
  selected: string;
};

export type LinkitUserPickerProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (userId: string, user: LinkitUserSearchResult | null) => void;
  name?: string;
  label?: string;
  placeholder?: string;
  lang?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
};

const labelsByLanguage: Record<"en" | "zh", LinkitUserPickerLabels> = {
  en: { label: "User", placeholder: "Search username or UUID", clear: "Clear selection", loading: "Searching users…", empty: "No users found by username or UUID.", selected: "Selected user" },
  zh: { label: "用户", placeholder: "搜索用户名或 UUID", clear: "清除选择", loading: "正在搜索用户…", empty: "未按用户名或 UUID 找到用户。", selected: "已选择用户" },
};

export function LinkitUserPicker({ value, defaultValue = "", onValueChange, name, label, placeholder, lang = "en", className, disabled = false, required = false }: LinkitUserPickerProps) {
  const linkit = useLinkit();
  const controlled = value !== undefined;
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const selectedId = controlled ? value : uncontrolledValue;
  const [selected, setSelected] = useState<LinkitUserSearchResult | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkitUserSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const labels = labelsByLanguage[languageKey(lang)];
  const visibleLabel = label ?? labels.label;

  useEffect(() => {
    if (selected?.user_id !== selectedId) setSelected(null);
  }, [selected?.user_id, selectedId]);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setActiveIndex(-1);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      linkit.searchUsers(term, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) {
            setResults(next);
            setActiveIndex(next.length ? 0 : -1);
            setOpen(true);
          }
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            setResults([]);
            setActiveIndex(-1);
            setError(message(cause));
            setOpen(true);
          }
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [linkit, query]);

  function choose(user: LinkitUserSearchResult) {
    if (!controlled) setUncontrolledValue(user.user_id);
    setSelected(user);
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
    setOpen(false);
    onValueChange?.(user.user_id, user);
    inputRef.current?.focus();
  }

  function clear() {
    if (!controlled) setUncontrolledValue("");
    setSelected(null);
    onValueChange?.("", null);
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length) { setOpen(true); setActiveIndex((index) => Math.min(index + 1, results.length - 1)); }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length) setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      choose(results[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const showList = open && Boolean(query.trim());
  const activeId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;
  return <div className={className}>
    {name ? <input type="hidden" name={name} value={selectedId ?? ""} /> : null}
    <label className="linkit-user-picker__label" htmlFor={`${listboxId}-input`}>{visibleLabel}</label>
    {selectedId ? <div className="linkit-user-picker__selection" aria-label={labels.selected}>
      <LinkitAvatar profile={selected} fallback={selected?.username || selectedId} size="sm" />
      <span className="linkit-user-picker__selection-text"><strong>{selected?.username || selectedId}</strong>{selected ? <span><code>{selected.user_id}</code></span> : null}</span>
      <button type="button" className="linkit-user-picker__clear" disabled={disabled} onClick={clear}>{labels.clear}</button>
    </div> : null}
    <input
      ref={inputRef}
      id={`${listboxId}-input`}
      type="search"
      className="linkit-user-picker__input"
      autoComplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-haspopup="listbox"
      aria-controls={showList ? listboxId : undefined}
      aria-expanded={showList}
      aria-activedescendant={activeId}
      placeholder={placeholder ?? labels.placeholder}
      disabled={disabled}
      required={required && !selectedId}
      value={query}
      onFocus={() => { if (query.trim()) setOpen(true); }}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
      onKeyDown={onKeyDown}
    />
    {showList ? <div className="linkit-user-picker__results" role="listbox" id={listboxId} aria-label={visibleLabel}>
      {loading ? <p className="linkit-user-picker__status" aria-live="polite">{labels.loading}</p> : null}
      {!loading && error ? <p className="linkit-user-picker__error" role="alert">{error}</p> : null}
      {!loading && !error && results.length === 0 ? <p className="linkit-user-picker__status">{labels.empty}</p> : null}
      {!loading && !error ? results.map((user, index) => <button
        id={`${listboxId}-option-${index}`}
        key={user.user_id}
        type="button"
        role="option"
        aria-selected={activeIndex === index}
        className="linkit-user-picker__option"
        data-active={activeIndex === index || undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(user)}
      ><LinkitAvatar profile={user} fallback={user.username} size="sm" /><span><strong>{user.username}</strong><span><code>{user.user_id}</code></span></span></button>) : null}
    </div> : null}
  </div>;
}

function languageKey(lang: string): "en" | "zh" { const normalized = lang.toLowerCase(); return normalized === "zh" || normalized.startsWith("zh-") ? "zh" : "en"; }
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
