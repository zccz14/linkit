import { initialLocale, translate } from "./locale.ts";

export function renderErrorCopy(browserLanguage: string) {
  const locale = initialLocale(browserLanguage, null);
  return {
    description: translate(locale, "renderError.description"),
    refresh: translate(locale, "renderError.refresh"),
    title: translate(locale, "renderError.title"),
  };
}
