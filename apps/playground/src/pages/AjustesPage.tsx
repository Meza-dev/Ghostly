import { useEffect, useState } from "react";
import { api, type FailConfig } from "../lib/api.js";
import { useToast } from "../context/ToastContext.js";
import { Spinner } from "../components/Spinner.js";

interface ToggleDef {
  key: keyof FailConfig;
  testId: string;
  label: string;
  description: string;
}

const toggles: ToggleDef[] = [
  {
    key: "failOnSave",
    testId: "toggle-fail-on-save",
    label: "Fallar al guardar (500)",
    description: "Los POST/PUT de clientes y pedidos devuelven un error 500 real.",
  },
  {
    key: "nonPersistingSave",
    testId: "toggle-non-persisting-save",
    label: "Guardar sin persistir",
    description: "El guardado responde 200 con éxito, pero el dato no queda registrado.",
  },
  {
    key: "validationRejects",
    testId: "toggle-validation-rejects",
    label: "Rechazar por validación (422)",
    description: "Los guardados siempre devuelven un error de validación.",
  },
  {
    key: "blockingModal",
    testId: "toggle-blocking-modal",
    label: "Modal bloqueante",
    description: "Muestra un modal que tapa las acciones principales hasta cerrarlo.",
  },
  {
    key: "slow",
    testId: "toggle-slow",
    label: "Respuestas lentas (~3s)",
    description: "Agrega ~3 segundos de demora a todas las respuestas del backend.",
  },
];

export function AjustesPage() {
  const [config, setConfig] = useState<FailConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await api.getConfig();
      setConfig(data);
    } catch {
      showToast("No se pudo cargar la configuración.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggle = async (key: keyof FailConfig, value: boolean) => {
    if (!config) return;
    const next = { ...config, [key]: value };
    setConfig(next);
    try {
      await api.updateConfig({ [key]: value });
    } catch {
      showToast("No se pudo actualizar la configuración.", "error");
    }
  };

  const handleReset = async () => {
    try {
      await api.resetData();
      showToast("Datos y configuración reiniciados.");
      await loadConfig();
    } catch {
      showToast("No se pudo reiniciar.", "error");
    }
  };

  if (loading || !config) return <Spinner />;

  return (
    <div>
      <h1 className="mb-2 text-xl font-bold text-gray-800">Ajustes</h1>
      <p className="mb-6 text-sm text-gray-600">
        Panel de inyección de fallas. Activá un modo para probar cómo reacciona Ghostly ante
        errores de backend, datos que no persisten, validaciones, UI bloqueante o lentitud.
      </p>

      <div className="mb-6 space-y-3">
        {toggles.map((toggle) => (
          <label
            key={toggle.key}
            className="flex cursor-pointer items-start gap-3 rounded-md bg-white p-4 shadow-sm"
          >
            <input
              type="checkbox"
              data-testid={toggle.testId}
              checked={config[toggle.key]}
              onChange={(e) => handleToggle(toggle.key, e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="block font-medium text-gray-800">{toggle.label}</span>
              <span className="block text-sm text-gray-500">{toggle.description}</span>
            </span>
          </label>
        ))}
      </div>

      <button
        type="button"
        data-testid="reset-data"
        onClick={handleReset}
        className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900"
      >
        Reset (restaurar seed)
      </button>
    </div>
  );
}
