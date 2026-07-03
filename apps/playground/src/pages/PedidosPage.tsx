import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Cliente, type Pedido } from "../lib/api.js";
import { useToast } from "../context/ToastContext.js";
import { Spinner } from "../components/Spinner.js";

export function PedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [clienteId, setClienteId] = useState("");
  const [producto, setProducto] = useState("");
  const [total, setTotal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  const loadAll = async () => {
    setLoading(true);
    try {
      const [pedidosData, clientesData] = await Promise.all([api.getPedidos(), api.getClientes()]);
      setPedidos(pedidosData);
      setClientes(clientesData);
    } catch {
      showToast("No se pudieron cargar los pedidos.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!clienteId || !producto.trim()) {
      showToast("Cliente y producto son obligatorios.", "error");
      return;
    }
    setSubmitting(true);
    try {
      await api.createPedido({
        clienteId: Number(clienteId),
        producto: producto.trim(),
        total: Number(total) || 0,
      });
      showToast("Pedido creado con éxito.");
      setProducto("");
      setTotal("");
      setClienteId("");
      await loadAll();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Error al crear el pedido.";
      showToast(message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const clienteNombre = (id: number) => clientes.find((c) => c.id === id)?.nombre ?? "—";

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold text-gray-800">Pedidos</h1>

      <form
        onSubmit={handleSubmit}
        className="mb-6 flex flex-wrap items-end gap-3 rounded-md bg-white p-4 shadow-sm"
      >
        <div>
          <label htmlFor="pedido-cliente" className="mb-1 block text-sm font-medium text-gray-700">
            Cliente
          </label>
          <select
            id="pedido-cliente"
            data-testid="pedido-form-cliente"
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          >
            <option value="">Seleccionar...</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="pedido-producto" className="mb-1 block text-sm font-medium text-gray-700">
            Producto
          </label>
          <input
            id="pedido-producto"
            data-testid="pedido-form-producto"
            type="text"
            value={producto}
            onChange={(e) => setProducto(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="pedido-total" className="mb-1 block text-sm font-medium text-gray-700">
            Total
          </label>
          <input
            id="pedido-total"
            data-testid="pedido-form-total"
            type="number"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="w-28 rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          data-testid="pedido-crear"
          disabled={submitting}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Guardando..." : "Crear pedido"}
        </button>
      </form>

      {loading ? (
        <Spinner />
      ) : pedidos.length === 0 ? (
        <div data-testid="pedidos-empty" className="rounded-md bg-white p-8 text-center text-gray-500">
          No hay pedidos para mostrar.
        </div>
      ) : (
        <table data-testid="pedidos-table" className="w-full overflow-hidden rounded-md bg-white shadow-sm">
          <thead className="bg-gray-50 text-left text-sm text-gray-600">
            <tr>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Producto</th>
              <th className="px-4 py-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((pedido) => (
              <tr data-testid={`pedido-row-${pedido.id}`} key={pedido.id} className="border-t border-gray-100">
                <td className="px-4 py-3">{clienteNombre(pedido.clienteId)}</td>
                <td className="px-4 py-3">{pedido.producto}</td>
                <td className="px-4 py-3">${pedido.total.toLocaleString("es-AR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
