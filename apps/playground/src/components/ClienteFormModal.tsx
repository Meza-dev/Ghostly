import { useState, type FormEvent } from "react";
import { Modal } from "./Modal.js";
import type { Cliente } from "../lib/api.js";

interface ClienteFormModalProps {
  initial?: Cliente | null;
  onCancel: () => void;
  onSubmit: (data: { nombre: string; email: string; ciudad: string }) => void;
  submitting: boolean;
  errorMessage?: string;
}

export function ClienteFormModal({
  initial,
  onCancel,
  onSubmit,
  submitting,
  errorMessage,
}: ClienteFormModalProps) {
  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [ciudad, setCiudad] = useState(initial?.ciudad ?? "");
  const [localError, setLocalError] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!nombre.trim()) {
      setLocalError("El nombre es obligatorio.");
      return;
    }
    setLocalError("");
    onSubmit({ nombre: nombre.trim(), email: email.trim(), ciudad: ciudad.trim() });
  };

  return (
    <Modal title={initial ? "Editar cliente" : "Nuevo cliente"} onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        {(localError || errorMessage) && (
          <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {localError || errorMessage}
          </div>
        )}

        <label htmlFor="cliente-nombre" className="mb-1 block text-sm font-medium text-gray-700">
          Nombre *
        </label>
        <input
          id="cliente-nombre"
          data-testid="cliente-form-nombre"
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="mb-4 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
        />

        <label htmlFor="cliente-email" className="mb-1 block text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="cliente-email"
          data-testid="cliente-form-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
        />

        <label htmlFor="cliente-ciudad" className="mb-1 block text-sm font-medium text-gray-700">
          Ciudad
        </label>
        <input
          id="cliente-ciudad"
          data-testid="cliente-form-ciudad"
          type="text"
          value={ciudad}
          onChange={(e) => setCiudad(e.target.value)}
          className="mb-6 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
        />

        <div className="flex justify-end gap-3">
          <button
            type="button"
            data-testid="cliente-form-cancelar"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            data-testid="cliente-form-guardar"
            disabled={submitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
