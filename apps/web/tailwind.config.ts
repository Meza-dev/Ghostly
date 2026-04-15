import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        foreground: "var(--color-foreground)",
        border: "var(--color-border)",
        muted: "var(--color-muted)",
        "muted-fg": "var(--color-muted-foreground)",
        card: "var(--color-card)",
        primary: "var(--color-primary)",
        "primary-fg": "var(--color-primary-foreground)",
        sidebar: "var(--color-sidebar)",
        "sidebar-accent": "var(--color-sidebar-accent)",
        "sidebar-fg": "var(--color-sidebar-foreground)",
        "sidebar-emphasis": "var(--color-sidebar-emphasis)",
        "sidebar-active": "var(--color-sidebar-active)",
        "sidebar-active-border": "var(--color-sidebar-active-border)",
        tile: "var(--color-tile)",
        success: "var(--color-success)",
        "success-fg": "var(--color-success-foreground)",
        error: "var(--color-error)",
        "error-fg": "var(--color-error-foreground)",
        warning: "var(--color-warning)",
        "warning-fg": "var(--color-warning-foreground)",
        accent: "var(--color-accent)",
        "accent-fg": "var(--color-accent-foreground)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
      },
      fontSize: {
        display: ["var(--text-display)", { lineHeight: "var(--leading-display)" }],
        title: ["var(--text-title)", { lineHeight: "var(--leading-title)" }],
        body: ["var(--text-body)", { lineHeight: "var(--leading-body)" }],
        small: ["var(--text-small)", { lineHeight: "var(--leading-small)" }],
        caption: ["var(--text-caption)", { lineHeight: "var(--leading-caption)" }],
        overline: ["var(--text-overline)", { lineHeight: "var(--leading-overline)" }],
        badge: ["var(--text-badge)", { lineHeight: "var(--leading-badge)" }],
      },
      borderRadius: {
        ui: "var(--radius-ui)",
        pill: "var(--radius-pill)",
      },
    },
  },
  plugins: [],
};

export default config;
