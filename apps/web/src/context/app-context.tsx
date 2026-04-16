import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Project = {
  id: string;
  label: string;
  color: string;
};

type AppContextValue = {
  projects: Project[];
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  addProject: (label: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
};

const COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/v1/projects");
      if (!res.ok) return;
      const data = (await res.json()) as Project[];
      setProjects(data);
    } catch {
      // ignorar errores de red
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function addProject(label: string) {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const res = await fetch("/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, color }),
    });
    if (!res.ok) return;
    const project = (await res.json()) as Project;
    setProjects((prev) => [...prev, project]);
  }

  async function deleteProject(id: string) {
    await fetch(`/v1/projects/${id}`, { method: "DELETE" });
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (activeProjectId === id) setActiveProjectId(null);
  }

  function toggleSidebar() {
    setSidebarCollapsed((v) => !v);
  }

  return (
    <AppContext.Provider
      value={{
        projects,
        activeProjectId,
        setActiveProjectId,
        addProject,
        deleteProject,
        sidebarCollapsed,
        toggleSidebar,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}
