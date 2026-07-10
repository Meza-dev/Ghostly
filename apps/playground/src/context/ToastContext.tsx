import { createContext, useContext, useState, type ReactNode } from "react";

type ToastKind = "success" | "error";

interface ToastState {
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  toast: ToastState | null;
  showToast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = (message: string, kind: ToastKind = "success") => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 3000);
  };

  return <ToastContext.Provider value={{ toast, showToast }}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
