import { seedClientes, seedPedidos, type Cliente, type Pedido } from "./seed.js";

export interface FailConfig {
  failOnSave: boolean;
  nonPersistingSave: boolean;
  validationRejects: boolean;
  blockingModal: boolean;
  slow: boolean;
}

export function defaultFailConfig(): FailConfig {
  return {
    failOnSave: false,
    nonPersistingSave: false,
    validationRejects: false,
    blockingModal: false,
    slow: false,
  };
}

class PlaygroundStore {
  clientes: Cliente[] = seedClientes();
  pedidos: Pedido[] = seedPedidos();
  config: FailConfig = defaultFailConfig();
  private nextClienteId = this.clientes.length + 1;
  private nextPedidoId = this.pedidos.length + 1;

  reset() {
    this.clientes = seedClientes();
    this.pedidos = seedPedidos();
    this.config = defaultFailConfig();
    this.nextClienteId = this.clientes.length + 1;
    this.nextPedidoId = this.pedidos.length + 1;
  }

  nextClientId(): number {
    return this.nextClienteId++;
  }

  nextOrderId(): number {
    return this.nextPedidoId++;
  }
}

export const store = new PlaygroundStore();
