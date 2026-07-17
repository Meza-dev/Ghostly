import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/auth-context";
import { AppProvider } from "./context/app-context";
import { useLanguage } from "./context/language-context";
import { CommandPalette } from "./components/command-palette";
import { Header } from "./components/header";
import { NewProjectModal } from "./components/new-project-modal";
import { Overview } from "./components/overview";
import { RunDetail } from "./components/run-detail";
import { RunsPanel } from "./components/runs-panel";
import { Sidebar } from "./components/sidebar";
import { StatusBar } from "./components/status-bar";
import { LoginPage } from "./pages/login";
import { SettingsPage } from "./pages/settings";

function GlobalNewProjectModal() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const fn = () => setOpen(true);
    window.addEventListener("ghostly:new-project", fn);
    return () => window.removeEventListener("ghostly:new-project", fn);
  }, []);
  if (!open) return null;
  return <NewProjectModal inputId="proj-label-shortcut" onClose={() => setOpen(false)} />;
}

function ProtectedLayout() {
  const { user, loading } = useAuth();
  const { t } = useLanguage();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-fg text-small">
        {t("common.loading")}
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <AppProvider>
      <div className="flex h-screen min-h-screen w-full flex-col gap-2 overflow-hidden bg-bg-shell pb-2">
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <Sidebar />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 pl-0">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-border bg-card shadow-surface">
              <CommandPalette />
              <GlobalNewProjectModal />
              <Header />
              <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-10 pb-5 pt-5">
                <Routes>
                  <Route path="/" element={<Overview />} />
                  <Route path="/runs" element={<RunsPanel />} />
                  <Route path="/runs/:id" element={<RunDetail />} />
                  <Route path="/flows" element={<PlaceholderPage title={t("app.nav.flows")} />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
              </main>
            </div>
          </div>
        </div>
        <StatusBar />
      </div>
    </AppProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<ProtectedLayout />} />
      </Routes>
    </AuthProvider>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  const { t } = useLanguage();
  return (
    <div className="flex h-full items-center justify-center text-muted-fg text-small">
      {t("app.placeholder.comingSoon", { title })}
    </div>
  );
}
