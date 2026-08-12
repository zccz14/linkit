import { createContext } from "react";

import type { Locale, TranslationKey } from "@/lib/locale";

export type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Record<string, string>) => string;
};

export const I18nContext = createContext<I18nContextValue | undefined>(
  undefined,
);
