import { Ghost, Loader2, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/auth-context";
import { useLanguage } from "../context/language-context";
import { useTheme } from "../context/theme-context";

export function LoginPage() {
  const { login } = useAuth();
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [primaryHover, setPrimaryHover] = useState(false);
  const [primaryPressed, setPrimaryPressed] = useState(false);
  const [ghostOffset, setGhostOffset] = useState({ x: 0, y: 0 });
  const [winking, setWinking] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = () => {
      timer = setTimeout(() => {
        setWinking(true);
        setTimeout(() => setWinking(false), 120);
        loop();
      }, 2000 + Math.random() * 4000);
    };
    loop();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const err = await login(email, password);
    setLoading(false);
    if (err) { setError(err); return; }
    navigate("/");
  }

  return (
    <div className="relative grid h-screen w-full grid-cols-1 bg-bg-shell text-foreground lg:grid-cols-[1.1fr_1fr]">
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-control-sm border border-border bg-card text-muted-fg shadow-sm transition-colors hover:bg-muted hover:text-foreground"
        aria-label={theme === "dark" ? t("login.theme.toLight") : t("login.theme.toDark")}
        title={theme === "dark" ? t("login.theme.lightTitle") : t("login.theme.darkTitle")}
      >
        {theme === "dark" ? <Sun className="h-4 w-4" strokeWidth={1.8} /> : <Moon className="h-4 w-4" strokeWidth={1.8} />}
      </button>
      <div className="relative hidden overflow-hidden border-r border-border bg-bg-main p-12 lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="login-aurora" />
        <div
          aria-hidden
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-border-default) 1px, transparent 1px), linear-gradient(90deg, var(--color-border-default) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse at center, black 32%, transparent 76%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, black 32%, transparent 76%)",
          }}
        />

        <div className="relative flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-surface ${
              theme === "light" ? "bg-muted text-foreground" : "bg-foreground text-bg-main"
            }`}
          >
            <Ghost className="h-5 w-5" strokeWidth={2} />
          </div>
          <span className="text-body font-title tracking-[-0.015em]">Ghostly</span>
        </div>

        <div className="relative mx-auto flex max-w-md flex-col items-center text-center">
          <div
            className="relative mb-6 flex h-44 w-44 items-center justify-center rounded-full bg-bg-muted"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - (rect.left + rect.width / 2);
              const y = e.clientY - (rect.top + rect.height / 2);
              setGhostOffset({
                x: Math.max(-2, Math.min(2, x / 20)),
                y: Math.max(-2, Math.min(2, y / 20)),
              });
            }}
            onMouseLeave={() => setGhostOffset({ x: 0, y: 0 })}
          >
            <div aria-hidden className="login-halo" />
            <div
              className="login-mascot-float relative z-10"
              style={{ transform: `translate(${ghostOffset.x}px, ${ghostOffset.y}px)` }}
            >
              <svg viewBox="0 0 200 200" width="120" height="120" aria-hidden>
                <defs>
                  <linearGradient id="ghost-body" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f6f5fb" />
                    <stop offset="100%" stopColor="#eceaf8" />
                  </linearGradient>
                </defs>
                <path
                  d="M40 95 a60 60 0 0 1 120 0 v68 l-12 -10 l-14 12 l-14 -12 l-14 12 l-14 -12 l-14 12 l-14 -12 l-12 10 z"
                  fill={theme === "light" ? "#0a0a0a" : "url(#ghost-body)"}
                />
                <g transform={`translate(${100 + ghostOffset.x * 1.2}, ${92 + ghostOffset.y})`}>
                  <ellipse cx="-16" cy="0" rx="6.2" ry={winking ? 0.7 : 7} fill="var(--color-brand-primary)" />
                  <ellipse cx="16" cy="0" rx="6.2" ry={winking ? 0.7 : 7} fill="var(--color-brand-primary)" />
                  {!winking && (
                    <>
                      <circle cx="-14" cy="-2" r="1.4" fill="#fff" opacity="0.9" />
                      <circle cx="18" cy="-2" r="1.4" fill="#fff" opacity="0.9" />
                    </>
                  )}
                </g>
              </svg>
            </div>
          </div>
          <h1 className="font-serif text-[30px] font-medium leading-[1.1] tracking-[-0.02em] text-foreground">
            {t("login.hero.titleLead")}<em className="text-primary not-italic">{t("login.hero.titleEmphasis")}</em>.
          </h1>
          <p className="mt-3 text-small text-muted-fg">
            {t("login.hero.subtitle")}
          </p>
        </div>
        <div className="relative flex items-center justify-between text-caption text-muted-fg">
          <span className="font-mono">v4.218</span>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <form onSubmit={handleSubmit} className="w-full max-w-[380px]">
          <div className="mb-5">
            <span className="text-overline font-overline uppercase text-muted-fg" style={{ letterSpacing: "var(--tracking-label)" }}>
              {t("login.form.overline")}
            </span>
            <h2 className="mt-2 text-[26px] font-title leading-tight tracking-[-0.02em] text-foreground">{t("login.form.title")}</h2>
          </div>

          <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label
              className="font-button uppercase text-muted-fg"
              htmlFor="email"
              style={{ fontSize: "var(--text-caption)", letterSpacing: "var(--tracking-label)" }}
            >
              {t("login.form.emailLabel")}
            </label>
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                background: "var(--color-input-login-shell-bg)",
                border: emailFocused
                  ? "var(--focus-border)"
                  : "1px solid var(--color-input-login-shell-border)",
                borderRadius: "var(--control-radius-input-login-shell)",
                paddingInline: "var(--control-padding-inline-input-login-shell)",
                boxShadow: emailFocused ? "var(--focus-ring)" : "none",
                transition: "var(--control-transition-input-login-shell)",
              }}
            >
              <input
                id="email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("login.form.emailPlaceholder")}
                className="login-auth-input w-full bg-transparent text-foreground placeholder:text-muted-fg focus:outline-none"
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                style={{
                  height: "44px",
                  fontSize: "var(--control-font-size-field)",
                  border: "none",
                  padding: 0,
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label
                className="font-button uppercase text-muted-fg"
                htmlFor="password"
                style={{ fontSize: "var(--text-caption)", letterSpacing: "var(--tracking-label)" }}
              >
                {t("login.form.passwordLabel")}
              </label>
            </div>
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                background: "var(--color-input-login-shell-bg)",
                border: passwordFocused
                  ? "var(--focus-border)"
                  : "1px solid var(--color-input-login-shell-border)",
                borderRadius: "var(--control-radius-input-login-shell)",
                paddingInline: "var(--control-padding-inline-input-login-shell)",
                boxShadow: passwordFocused ? "var(--focus-ring)" : "none",
                transition: "var(--control-transition-input-login-shell)",
              }}
            >
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="•••••••••"
                className="login-auth-input w-full bg-transparent text-foreground placeholder:text-muted-fg focus:outline-none"
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                style={{
                  height: "44px",
                  fontSize: "var(--control-font-size-field)",
                  border: "none",
                  padding: 0,
                }}
              />
            </div>
          </div>

          {error && (
            <p className="rounded-control-lg bg-error px-3 py-2 text-caption text-error-fg">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 bg-primary font-title disabled:opacity-60"
            style={{
              height: "var(--control-height-button-primary)",
              borderRadius: "var(--control-radius-button-primary)",
              paddingInline: "var(--control-padding-inline-button-primary)",
              paddingBlock: "var(--control-padding-block-button-primary)",
              fontSize: "var(--control-font-size-button-login)",
              fontWeight: 600,
              letterSpacing: "var(--control-letter-spacing-button-login)",
              border: "none",
              transition:
                "transform var(--motion-transform) var(--motion-standard), box-shadow var(--motion-color) ease, background-color var(--motion-color) ease",
              boxShadow: primaryHover && !loading ? "var(--shadow-button-primary-hover)" : "none",
              backgroundColor: loading
                ? "var(--color-button-primary-login-disabled-bg)"
                : primaryPressed
                ? "var(--color-brand-primary-pressed)"
                : primaryHover
                ? "var(--color-brand-primary-hover)"
                : "var(--color-brand-primary)",
              color: loading
                ? "var(--color-button-primary-login-disabled-fg)"
                : "var(--color-button-primary-login-fg)",
              transform: primaryPressed ? "translateY(1px)" : "translateY(0)",
            }}
            onMouseEnter={() => {
              setPrimaryHover(true);
            }}
            onMouseLeave={() => {
              setPrimaryHover(false);
              setPrimaryPressed(false);
            }}
            onMouseDown={() => setPrimaryPressed(true)}
            onMouseUp={() => setPrimaryPressed(false)}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                {t("login.form.submitLoading")}
              </>
            ) : (
              <>{t("login.form.submit")}</>
            )}
          </button>

          <p className="text-center text-caption text-muted-fg">
            {t("login.form.noAccount")}{" "}
            <button type="button" className="font-button text-foreground hover:text-primary">
              {t("login.form.signUp")}
            </button>
          </p>
          </div>
        </form>
      </div>
    </div>
  );
}
