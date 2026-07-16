import { useLanguage } from "../context/language-context";

/** Botón compacto EN/ES, espejo del toggle de tema del sidebar. */
export function LanguageToggle() {
  const { lang, toggleLang, t } = useLanguage();
  const label = lang === "en" ? t("lang.toggle.toEs") : t("lang.toggle.toEn");

  return (
    <button
      type="button"
      onClick={toggleLang}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control-sm text-caption font-badge uppercase text-sidebar-fg transition-colors hover:bg-sidebar-accent hover:text-sidebar-emphasis"
    >
      {lang}
    </button>
  );
}
