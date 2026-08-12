import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { I18nContext } from "@/components/i18n-context";
import {
  initialLocale,
  translate,
  type Locale,
  type TranslationKey,
} from "@/lib/locale";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() =>
    initialLocale(navigator.language, localStorage.getItem("linkit.locale")),
  );
  const t = useCallback(
    (key: TranslationKey, values?: Record<string, string>) =>
      translate(locale, key, values),
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem("linkit.locale", locale);
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
