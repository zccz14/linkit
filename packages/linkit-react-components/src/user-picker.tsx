import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { LinkitAvatar } from "./displays.js";
import { useLinkit } from "./linkit-provider.js";
import type { LinkitUserSearchResult } from "./types.js";

export type LinkitUserPickerLabels = {
  label: string;
  placeholder: string;
  clear: string;
  clearAll: string;
  remove: string;
  loading: string;
  empty: string;
  selected: string;
  selectedMembers: string;
  unknown: string;
};

type SharedProps = {
  name?: string;
  label?: string;
  placeholder?: string;
  lang?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
};

export type LinkitUserPickerSingleProps = SharedProps & {
  multiple?: false;
  value?: string;
  defaultValue?: string;
  onValueChange?: (userId: string, user: LinkitUserSearchResult | null) => void;
};

export type LinkitUserPickerMultipleProps = SharedProps & {
  multiple: true;
  value: string[];
  onValueChange: (userIds: string[], users: LinkitUserSearchResult[]) => void;
};

export type LinkitUserPickerProps =
  LinkitUserPickerSingleProps | LinkitUserPickerMultipleProps;

const labelsByLanguage: Record<"en" | "zh", LinkitUserPickerLabels> = {
  en: {
    label: "User",
    placeholder: "Search username or UUID",
    clear: "Clear selection",
    clearAll: "Clear all members",
    remove: "Remove {username}",
    loading: "Searching users…",
    empty: "No users found by username or UUID.",
    selected: "Selected user",
    selectedMembers: "Selected members",
    unknown: "Unknown user",
  },
  zh: {
    label: "用户",
    placeholder: "搜索用户名或 UUID",
    clear: "清除选择",
    clearAll: "清除所有成员",
    remove: "移除 {username}",
    loading: "正在搜索用户…",
    empty: "未按用户名或 UUID 找到用户。",
    selected: "已选择用户",
    selectedMembers: "已选择成员",
    unknown: "未知用户",
  },
};

export function LinkitUserPicker(props: LinkitUserPickerProps) {
  return props.multiple ? (
    <MultipleUserPicker {...props} />
  ) : (
    <SingleUserPicker {...props} />
  );
}

function SingleUserPicker({
  value,
  defaultValue = "",
  onValueChange,
  name,
  label,
  placeholder,
  lang = "en",
  className,
  disabled = false,
  required = false,
}: LinkitUserPickerSingleProps) {
  const controlled = value !== undefined;
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const selectedId = controlled ? value : uncontrolledValue;
  const selectedIds = useMemo(
    () => (selectedId ? [selectedId] : []),
    [selectedId],
  );
  return (
    <PickerControl
      className={className}
      disabled={disabled}
      label={label}
      lang={lang}
      name={name}
      placeholder={placeholder}
      required={required}
      selectedIds={selectedIds}
      selectionMode="single"
      onChoose={(user) => {
        if (!controlled) setUncontrolledValue(user.user_id);
        onValueChange?.(user.user_id, user);
      }}
      onRemove={() => {
        if (!controlled) setUncontrolledValue("");
        onValueChange?.("", null);
      }}
      onClear={() => {
        if (!controlled) setUncontrolledValue("");
        onValueChange?.("", null);
      }}
    />
  );
}

function MultipleUserPicker({
  value,
  onValueChange,
  name,
  label,
  placeholder,
  lang = "en",
  className,
  disabled = false,
  required = false,
}: LinkitUserPickerMultipleProps) {
  const selectedIds = useMemo(() => unique(value), [value]);
  const change = (nextIds: string[], users: LinkitUserSearchResult[]) =>
    onValueChange(unique(nextIds), users);
  return (
    <PickerControl
      className={className}
      disabled={disabled}
      label={label}
      lang={lang}
      name={name}
      placeholder={placeholder}
      required={required}
      selectedIds={selectedIds}
      selectionMode="multiple"
      onChoose={(user, users) => change([...selectedIds, user.user_id], users)}
      onRemove={(userId, users) =>
        change(
          selectedIds.filter((id) => id !== userId),
          users,
        )
      }
      onClear={() => change([], [])}
    />
  );
}

type PickerControlProps = {
  className?: string;
  disabled: boolean;
  label?: string;
  lang: string;
  name?: string;
  placeholder?: string;
  required: boolean;
  selectedIds: string[];
  selectionMode: "single" | "multiple";
  onChoose: (
    user: LinkitUserSearchResult,
    users: LinkitUserSearchResult[],
  ) => void;
  onRemove: (userId: string, users: LinkitUserSearchResult[]) => void;
  onClear: () => void;
};

function PickerControl({
  className,
  disabled,
  label,
  lang,
  name,
  placeholder,
  required,
  selectedIds,
  selectionMode,
  onChoose,
  onRemove,
  onClear,
}: PickerControlProps) {
  const linkit = useLinkit();
  const [selectedUsers, setSelectedUsers] = useState<LinkitUserSearchResult[]>(
    [],
  );
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
  const selected = selectedIds.map(
    (id) =>
      selectedUsers.find((user) => user.user_id === id) ?? {
        user_id: id,
        username: labels.unknown,
      },
  );

  useEffect(() => {
    setSelectedUsers((current) =>
      current.filter((user) => selectedIds.includes(user.user_id)),
    );
  }, [selectedIds]);

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
      linkit
        .searchUsers(term, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) {
            const available = next.filter(
              (user) => !selectedIds.includes(user.user_id),
            );
            setResults(available);
            setActiveIndex(available.length ? 0 : -1);
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
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [linkit, query, selectedIds]);

  function choose(user: LinkitUserSearchResult) {
    const users =
      selectionMode === "single"
        ? [user]
        : uniqueUsers([...selectedUsers, user]);
    setSelectedUsers(users);
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
    setOpen(false);
    onChoose(user, users);
    inputRef.current?.focus();
  }

  function remove(userId: string) {
    const users = selectedUsers.filter((user) => user.user_id !== userId);
    setSelectedUsers(users);
    onRemove(userId, users);
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length) {
        setOpen(true);
        setActiveIndex((index) => Math.min(index + 1, results.length - 1));
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length) setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      choose(results[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    } else if (
      event.key === "Backspace" &&
      !query &&
      selectionMode === "multiple" &&
      selectedIds.length
    ) {
      remove(selectedIds[selectedIds.length - 1]);
    }
  }

  const showList = open && Boolean(query.trim());
  const activeId =
    activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;
  const selectedLabel =
    selectionMode === "single" ? labels.selected : labels.selectedMembers;
  return (
    <div
      className={[
        "linkit-user-picker",
        `linkit-user-picker--${selectionMode}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {name
        ? selectedIds.map((userId) => (
            <input key={userId} type="hidden" name={name} value={userId} />
          ))
        : null}
      <label
        className="linkit-user-picker__label"
        htmlFor={`${listboxId}-input`}
      >
        {visibleLabel}
      </label>
      {selectedIds.length ? (
        <div
          className="linkit-user-picker__selection"
          aria-label={selectedLabel}
        >
          <div className="linkit-user-picker__selected-users">
            {selected.map((user) => (
              <div
                className="linkit-user-picker__selected-user"
                key={user.user_id}
              >
                <LinkitAvatar
                  profile={user}
                  fallback={user.username}
                  size="sm"
                />
                <strong title={user.username}>{user.username}</strong>
                <button
                  type="button"
                  className="linkit-user-picker__remove"
                  disabled={disabled}
                  aria-label={labels.remove.replace(
                    "{username}",
                    user.username,
                  )}
                  onClick={() => remove(user.user_id)}
                >
                  {selectionMode === "single" ? labels.clear : "×"}
                </button>
              </div>
            ))}
          </div>
          {selectionMode === "multiple" && selectedIds.length > 1 ? (
            <button
              type="button"
              className="linkit-user-picker__clear"
              disabled={disabled}
              onClick={onClear}
            >
              {labels.clearAll}
            </button>
          ) : null}
        </div>
      ) : null}
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
        required={required && !selectedIds.length}
        value={query}
        onFocus={() => {
          if (query.trim()) setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <div
          className="linkit-user-picker__results"
          role="listbox"
          id={listboxId}
          aria-label={visibleLabel}
        >
          {loading ? (
            <p className="linkit-user-picker__status" aria-live="polite">
              {labels.loading}
            </p>
          ) : null}
          {!loading && error ? (
            <p className="linkit-user-picker__error" role="alert">
              {error}
            </p>
          ) : null}
          {!loading && !error && results.length === 0 ? (
            <p className="linkit-user-picker__status">{labels.empty}</p>
          ) : null}
          {!loading && !error
            ? results.map((user, index) => (
                <button
                  id={`${listboxId}-option-${index}`}
                  key={user.user_id}
                  type="button"
                  role="option"
                  aria-selected={activeIndex === index}
                  className="linkit-user-picker__option"
                  data-active={activeIndex === index || undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(user)}
                >
                  <LinkitAvatar
                    profile={user}
                    fallback={user.username}
                    size="sm"
                  />
                  <span>
                    <strong>{user.username}</strong>
                  </span>
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

function unique(values: string[]) {
  return [...new Set(values)];
}
function uniqueUsers(users: LinkitUserSearchResult[]) {
  return users.filter(
    (user, index) =>
      users.findIndex((candidate) => candidate.user_id === user.user_id) ===
      index,
  );
}
function languageKey(lang: string): "en" | "zh" {
  const normalized = lang.toLowerCase();
  return normalized === "zh" || normalized.startsWith("zh-") ? "zh" : "en";
}
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
