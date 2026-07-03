import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { store } from "./state.js";
import type { Cliente, Pedido } from "./seed.js";

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyQueryFailParam(url: string) {
  const query = url.split("?")[1];
  if (!query) return;
  const params = new URLSearchParams(query);
  const fail = params.get("fail");
  if (!fail) return;
  if (fail === "save") store.config.failOnSave = true;
  if (fail === "non-persisting") store.config.nonPersistingSave = true;
  if (fail === "validation") store.config.validationRejects = true;
  if (fail === "blocking-modal") store.config.blockingModal = true;
  if (fail === "slow") store.config.slow = true;
}

export function ghostlyFakeApiPlugin(): Plugin {
  return {
    name: "ghostly-fake-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/")) {
          next();
          return;
        }

        applyQueryFailParam(url);

        const [pathname] = url.split("?");
        const method = req.method ?? "GET";

        if (store.config.slow) {
          await delay(3000);
        }

        // --- config ---
        if (pathname === "/api/config" && method === "GET") {
          sendJson(res, 200, store.config);
          return;
        }
        if (pathname === "/api/config" && method === "POST") {
          const body = await readBody(req);
          store.config = { ...store.config, ...body };
          sendJson(res, 200, store.config);
          return;
        }
        if (pathname === "/api/reset" && method === "POST") {
          store.reset();
          sendJson(res, 200, { ok: true });
          return;
        }

        // --- clientes ---
        if (pathname === "/api/clientes" && method === "GET") {
          sendJson(res, 200, store.clientes);
          return;
        }
        if (pathname === "/api/clientes" && method === "POST") {
          const body = await readBody(req);

          if (store.config.failOnSave) {
            sendJson(res, 500, { error: "Error interno del servidor al guardar el cliente." });
            return;
          }

          const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
          if (store.config.validationRejects || !nombre) {
            sendJson(res, 422, { error: "El nombre es obligatorio." });
            return;
          }

          const cliente: Cliente = {
            id: store.nextClientId(),
            nombre,
            email: typeof body.email === "string" ? body.email : "",
            ciudad: typeof body.ciudad === "string" ? body.ciudad : "",
          };

          if (!store.config.nonPersistingSave) {
            store.clientes.push(cliente);
          }
          sendJson(res, 201, cliente);
          return;
        }

        const clienteMatch = pathname.match(/^\/api\/clientes\/(\d+)$/);
        if (clienteMatch) {
          const id = Number(clienteMatch[1]);

          if (method === "PUT") {
            const body = await readBody(req);

            if (store.config.failOnSave) {
              sendJson(res, 500, { error: "Error interno del servidor al guardar el cliente." });
              return;
            }

            const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
            if (store.config.validationRejects || !nombre) {
              sendJson(res, 422, { error: "El nombre es obligatorio." });
              return;
            }

            const existing = store.clientes.find((c) => c.id === id);
            if (!existing) {
              sendJson(res, 404, { error: "Cliente no encontrado." });
              return;
            }

            const updated: Cliente = {
              id,
              nombre,
              email: typeof body.email === "string" ? body.email : existing.email,
              ciudad: typeof body.ciudad === "string" ? body.ciudad : existing.ciudad,
            };

            if (!store.config.nonPersistingSave) {
              store.clientes = store.clientes.map((c) => (c.id === id ? updated : c));
            }
            sendJson(res, 200, updated);
            return;
          }

          if (method === "DELETE") {
            if (store.config.failOnSave) {
              sendJson(res, 500, { error: "Error interno del servidor al eliminar el cliente." });
              return;
            }
            if (!store.config.nonPersistingSave) {
              store.clientes = store.clientes.filter((c) => c.id !== id);
            }
            sendJson(res, 200, { ok: true });
            return;
          }
        }

        // --- pedidos ---
        if (pathname === "/api/pedidos" && method === "GET") {
          sendJson(res, 200, store.pedidos);
          return;
        }
        if (pathname === "/api/pedidos" && method === "POST") {
          const body = await readBody(req);

          if (store.config.failOnSave) {
            sendJson(res, 500, { error: "Error interno del servidor al guardar el pedido." });
            return;
          }

          const clienteId = Number(body.clienteId);
          const producto = typeof body.producto === "string" ? body.producto.trim() : "";
          if (store.config.validationRejects || !producto || !clienteId) {
            sendJson(res, 422, { error: "Cliente y producto son obligatorios." });
            return;
          }

          const pedido: Pedido = {
            id: store.nextOrderId(),
            clienteId,
            producto,
            total: Number(body.total) || 0,
          };

          if (!store.config.nonPersistingSave) {
            store.pedidos.push(pedido);
          }
          sendJson(res, 201, pedido);
          return;
        }

        sendJson(res, 404, { error: "Not found" });
      });
    },
  };
}
