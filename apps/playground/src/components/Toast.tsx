import { useToast } from "../context/ToastContext.js";

export function Toast() {
  const { toast } = useToast();

  if (!toast) return null;

  const color = toast.kind === "success" ? "bg-green-600" : "bg-red-600";

  return (
    <div
      data-testid="toast"
      data-kind={toast.kind}
      className={`fixed bottom-4 right-4 z-50 rounded-md px-4 py-3 text-white shadow-lg ${color}`}
    >
      {toast.message}
    </div>
  );
}
