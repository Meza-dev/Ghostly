import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/auth-context";
import { AppProvider } from "./context/app-context";
import { Header } from "./components/header";
import { Overview } from "./components/overview";
import { RunDetail } from "./components/run-detail";
import { RunsPanel } from "./components/runs-panel";
import { Sidebar } from "./components/sidebar";
import { StatusBar } from "./components/status-bar";
import { LoginPage } from "./pages/login";
import { SettingsPage } from "./pages/settings";

function ProtectedLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-fg text-small">
        Cargando…
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <AppProvider>
      <div className="flex h-screen min-h-screen w-full overflow-hidden bg-background">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Header />
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-4 pt-2.5">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/runs" element={<RunsPanel />} />
              <Route path="/runs/:id" element={<RunDetail />} />
              <Route path="/flows" element={<PlaceholderPage title="Flujos & casos" />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
          <StatusBar />
        </div>
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
  return (
    <div className="flex h-full items-center justify-center text-muted-fg text-small">
      {title} — próximamente
    </div>
  );
}
