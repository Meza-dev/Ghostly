import { Route, Routes } from "react-router-dom";
import { AppProvider } from "./context/app-context";
import { Header } from "./components/header";
import { Overview } from "./components/overview";
import { RunDetail } from "./components/run-detail";
import { RunsPanel } from "./components/runs-panel";
import { Sidebar } from "./components/sidebar";
import { StatusBar } from "./components/status-bar";

export function App() {
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
              <Route path="/settings" element={<PlaceholderPage title="Preferencias" />} />
            </Routes>
          </main>
          <StatusBar />
        </div>
      </div>
    </AppProvider>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex h-full items-center justify-center text-muted-fg text-small">
      {title} — próximamente
    </div>
  );
}
