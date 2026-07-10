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

export function seedClientes(): Cliente[] {
  return [
    { id: 1, nombre: "Ana García", email: "ana.garcia@example.com", ciudad: "Buenos Aires" },
    { id: 2, nombre: "Carlos Rodríguez", email: "carlos.rodriguez@example.com", ciudad: "Córdoba" },
    { id: 3, nombre: "Lucía Fernández", email: "lucia.fernandez@example.com", ciudad: "Rosario" },
    { id: 4, nombre: "Martín López", email: "martin.lopez@example.com", ciudad: "Mendoza" },
    { id: 5, nombre: "Sofía Martínez", email: "sofia.martinez@example.com", ciudad: "La Plata" },
  ];
}

export function seedPedidos(): Pedido[] {
  return [
    { id: 1, clienteId: 1, producto: "Notebook", total: 850000 },
    { id: 2, clienteId: 2, producto: "Monitor", total: 210000 },
  ];
}
