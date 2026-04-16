import { createContext, useContext, useState } from "react";

export type Project = {
  id: string;
  label: string;
  color: string;
};

const DEFAULT_PROJECTS: Project[] = [
  { id: "ghosttester-ai", label: "ghosttester-ai", color: "#5b9cf8" },
  { id: "acme-web", label: "acme-web", color: "#9ddec0" },
];

type AppContextValue = {
  projects: Project[];
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  addProject: (label: string) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>(DEFAULT_PROJECTS);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  function addProject(label: string) {
    const id = label.toLowerCase().replace(/\s+/g, "-");
    const colors = ["#f8a15b", "#c45bf8", "#f85b7a", "#5bf8c4"];
    const color = colors[projects.length % colors.length] ?? "#5b9cf8";
    setProjects((prev) => [...prev, { id, label, color }]);
  }

  return (
    <AppContext.Provider
      value={{
        projects,
        activeProjectId,
        setActiveProjectId,
        addProject,
        sidebarCollapsed,
        toggleSidebar: () => setSidebarCollapsed((v) => !v),
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
