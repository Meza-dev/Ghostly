export interface Cliente {
  id: number;
  nombre: string;
  email: string;
  ciudad: string;
}

export interface Pedido {
  id: number;
  clienteId: number;
  producto: string;
  total: number;
}

export interface FailConfig {
  failOnSave: boolean;
  nonPersistingSave: boolean;
  validationRejects: boolean;
  blockingModal: boolean;
  slow: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? "Error desconocido");
  }
  return data as T;
}

export const api = {
  getClientes: () => request<Cliente[]>("/api/clientes"),
  createCliente: (payload: Omit<Cliente, "id">) =>
    request<Cliente>("/api/clientes", { method: "POST", body: JSON.stringify(payload) }),
  updateCliente: (id: number, payload: Omit<Cliente, "id">) =>
    request<Cliente>(`/api/clientes/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteCliente: (id: number) => request<{ ok: boolean }>(`/api/clientes/${id}`, { method: "DELETE" }),

  getPedidos: () => request<Pedido[]>("/api/pedidos"),
  createPedido: (payload: Omit<Pedido, "id">) =>
    request<Pedido>("/api/pedidos", { method: "POST", body: JSON.stringify(payload) }),

  getConfig: () => request<FailConfig>("/api/config"),
  updateConfig: (payload: Partial<FailConfig>) =>
    request<FailConfig>("/api/config", { method: "POST", body: JSON.stringify(payload) }),
  resetData: () => request<{ ok: boolean }>("/api/reset", { method: "POST" }),
};
