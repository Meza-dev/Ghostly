import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Cliente } from "../lib/api.js";
import { useToast } from "../context/ToastContext.js";
import { Spinner } from "../components/Spinner.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { ClienteFormModal } from "../components/ClienteFormModal.js";

type ModalState =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; cliente: Cliente }
  | { kind: "delete"; cliente: Cliente };

export function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const { showToast } = useToast();

  const loadClientes = async () => {
    setLoading(true);
    try {
      const data = await api.getClientes();
      setClientes(data);
    } catch {
      showToast("No se pudieron cargar los clientes.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClientes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => clientes.filter((c) => c.nombre.toLowerCase().includes(search.toLowerCase())),
    [clientes, search],
  );

  const closeModal = () => {
    setModal({ kind: "none" });
    setFormError(undefined);
  };

  const handleCreate = async (data: { nombre: string; email: string; ciudad: string }) => {
    setSubmitting(true);
    setFormError(undefined);
    try {
      await api.createCliente(data);
      showToast("Cliente creado con éxito.");
      closeModal();
      await loadClientes();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Error al crear el cliente.";
      setFormError(message);
      showToast(message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (
    id: number,
    data: { nombre: string; email: string; ciudad: string },
  ) => {
    setSubmitting(true);
    setFormError(undefined);
    try {
      await api.updateCliente(id, data);
      showToast("Cliente actualizado con éxito.");
      closeModal();
      await loadClientes();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Error al actualizar el cliente.";
      setFormError(message);
      showToast(message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (cliente: Cliente) => {
    try {
      await api.deleteCliente(cliente.id);
      showToast("Cliente eliminado.");
      setModal({ kind: "none" });
      await loadClientes();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Error al eliminar el cliente.";
      showToast(message, "error");
      setModal({ kind: "none" });
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Clientes</h1>
        <button
          type="button"
          data-testid="cliente-crear"
          onClick={() => setModal({ kind: "create" })}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Nuevo cliente
        </button>
      </div>

      <input
        data-testid="clientes-search"
        type="text"
        placeholder="Buscar por nombre..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
      />

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div data-testid="clientes-empty" className="rounded-md bg-white p-8 text-center text-gray-500">
          No hay clientes para mostrar.
        </div>
      ) : (
        <table data-testid="clientes-table" className="w-full overflow-hidden rounded-md bg-white shadow-sm">
          <thead className="bg-gray-50 text-left text-sm text-gray-600">
            <tr>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Ciudad</th>
              <th className="px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((cliente) => (
              <tr data-testid={`cliente-row-${cliente.id}`} key={cliente.id} className="border-t border-gray-100">
                <td className="px-4 py-3">{cliente.nombre}</td>
                <td className="px-4 py-3 text-gray-600">{cliente.email}</td>
                <td className="px-4 py-3 text-gray-600">{cliente.ciudad}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    data-testid={`cliente-editar-${cliente.id}`}
                    onClick={() => setModal({ kind: "edit", cliente })}
                    className="mr-3 text-sm text-blue-600 hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    data-testid={`cliente-eliminar-${cliente.id}`}
                    onClick={() => setModal({ kind: "delete", cliente })}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modal.kind === "create" && (
        <ClienteFormModal
          onCancel={closeModal}
          onSubmit={handleCreate}
          submitting={submitting}
          errorMessage={formError}
        />
      )}

      {modal.kind === "edit" && (
        <ClienteFormModal
          initial={modal.cliente}
          onCancel={closeModal}
          onSubmit={(data) => handleUpdate(modal.cliente.id, data)}
          submitting={submitting}
          errorMessage={formError}
        />
      )}

      {modal.kind === "delete" && (
        <ConfirmDialog
          message={`¿Eliminar a ${modal.cliente.nombre}? Esta acción no se puede deshacer.`}
          onConfirm={() => handleDelete(modal.cliente)}
          onCancel={() => setModal({ kind: "none" })}
        />
      )}
    </div>
  );
}
