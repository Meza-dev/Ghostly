import { Header } from "./components/header";
import { RunsPanel } from "./components/runs-panel";
import { Sidebar } from "./components/sidebar";
import { StatusBar } from "./components/status-bar";

export function App() {
  return (
    <div className="flex h-screen min-h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-4 pt-2.5">
          <RunsPanel />
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
