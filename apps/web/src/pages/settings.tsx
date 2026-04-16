import { Copy, Key, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../context/auth-context";
import { apiFetch } from "../lib/api";

type ApiKeyRecord = {
  id: string;
  label: string;
  key: string;
  createdAt: string;
};

export function SettingsPage() {
  const { user } = useAuth();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadKeys() {
    const res = await apiFetch("/v1/api-keys");
    if (res.ok) setKeys((await res.json()) as ApiKeyRecord[]);
  }

  useEffect(() => { void loadKeys(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setCreating(true);
    const res = await apiFetch("/v1/api-keys", {
      method: "POST",
      body: JSON.stringify({ label: label.trim() }),
    });
    setCreating(false);
    if (!res.ok) return;
    const data = (await res.json()) as ApiKeyRecord;
    setNewKey(data.key);
    setLabel("");
    void loadKeys();
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Revocar esta API Key?")) return;
    await apiFetch(`/v1/api-keys/${id}`, { method: "DELETE" });
    void loadKeys();
  }

  function copyKey(k: string) {
    void navigator.clipboard.writeText(k).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-auto pb-4">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-title font-title text-foreground">Preferencias</h2>
          <p className="text-caption text-muted-fg">
            Sesión iniciada como <span className="font-nav-active text-foreground">{user?.email}</span> (
            <span className="capitalize">{user?.role}</span>). Cierra sesión desde la barra lateral.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <h3 className="text-body font-nav-active text-foreground">API Keys</h3>
          <p className="text-caption text-muted-fg">
            Para scripts, CI o el paquete <code className="rounded bg-muted px-1 py-0.5 font-mono text-caption">@ghosttester/client</code>: crea una key y envíala en el header{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-caption">X-Api-Key</code>.
          </p>
        </div>

        {/* Alerta con la nueva key */}
        {newKey && (
          <div className="flex items-center gap-3 rounded-ui border border-success/40 bg-success/10 px-4 py-3">
            <Key className="h-4 w-4 shrink-0 text-success" strokeWidth={2} />
            <div className="min-w-0 flex-1">
              <p className="text-caption font-button text-success">Copia esta key ahora, no se mostrará de nuevo</p>
              <p className="mt-1 break-all font-mono text-caption text-foreground">{newKey}</p>
            </div>
            <button
              type="button"
              onClick={() => copyKey(newKey)}
              className="shrink-0 rounded border border-border p-1.5 text-muted-fg hover:text-foreground"
            >
              <Copy className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            {copied && <span className="text-caption text-success">Copiado</span>}
          </div>
        )}

        {/* Crear nueva key */}
        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            type="text"
            placeholder="Nombre de la key (ej. CI pipeline)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="flex-1 rounded-[8px] border border-border bg-background px-3 py-2 text-small text-foreground placeholder:text-muted-fg focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={creating || !label.trim()}
            className="inline-flex items-center gap-2 rounded-pill bg-primary px-4 py-2 text-small font-button text-primary-fg hover:opacity-95 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            {creating ? "Creando…" : "Crear"}
          </button>
        </form>

        {/* Lista de keys */}
        {keys.length === 0 ? (
          <p className="text-small text-muted-fg">No tienes API Keys aún.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-ui border border-border bg-card">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 px-5 py-3">
                <Key className="h-4 w-4 shrink-0 text-muted-fg" strokeWidth={2} />
                <div className="min-w-0 flex-1">
                  <p className="text-small font-button text-foreground">{k.label}</p>
                  <p className="font-mono text-caption text-muted-fg">{k.key}</p>
                </div>
                <span className="shrink-0 text-caption text-muted-fg">
                  {new Date(k.createdAt).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(k.id)}
                  className="shrink-0 rounded p-1 text-muted-fg hover:text-destructive"
                  aria-label="Revocar"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
