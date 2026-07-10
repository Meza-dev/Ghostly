# Spec — Ghostly Playground (app de prueba)

> **Estado:** aprobado para Fase 1 (2026-07-03).
> **Naturaleza:** app DESCARTABLE de prueba, NO un producto real. Rápido y simple > correcto. Malas prácticas OK. NO importa: seguridad, patrones, arquitectura, tests. SÍ importa: que funcione, que se vea como una app real, y **`data-testid` en TODO elemento interactivo** (es el único requisito de calidad, porque es el que hace a la app usable por Ghostly).

## 1. Propósito

Una app realista y controlable cuyo ÚNICO fin es ser blanco de pruebas de Ghostly — manual (el usuario apunta Ghostly y le da objetivos en lenguaje natural) y a futuro base del benchmark ampliado. Cubre los patrones web comunes (login, navegación, tabla, búsqueda, ABM/CRUD, modales) **más un panel para inyectar fallas** a voluntad, para probar cómo reacciona Ghostly (juez, circuit breaker, veredictos).

La fixture mínima del benchmark (`packages/runner/test-fixtures/app.ts`) NO se toca — esto es aparte.

## 2. Stack y forma

- `apps/playground`: **React + Vite + Tailwind** (mismas versiones que `apps/web`). SPA con routing del lado del cliente.
- **Mini-backend fake dentro de Vite**: un plugin `configureServer` que sirve `/api/*` con datos EN MEMORIA y soporte de fallas. Un solo proceso, un solo puerto. Esto da **HTTP real** (500s reales para el circuit breaker de Ghostly).
- Puerto fijo **4700**. Script raíz `pnpm playground`. UI en español.
- Sin base de datos, sin auth real, sin build de producción pensado — es descartable.

## 3. Alcance Fase 1 (lo que se construye ahora)

### Auth
- Página de login: usuario + contraseña. CUALQUIER credencial no vacía loguea (o hardcodear `admin`/`admin`). Guarda estado "logueado" en memoria/context. Logout en la topbar.
- `data-testid`: `login-user`, `login-password`, `login-submit`.

### Layout / navegación
- Sidebar con: **Clientes**, **Pedidos**, **Ajustes**. Topbar con nombre de usuario + logout.
- Routing client-side (`react-router-dom`, lo más simple).
- `data-testid`: `nav-clientes`, `nav-pedidos`, `nav-ajustes`, `logout-button`.

### Clientes (la entidad principal — ABM completo)
- **Tabla** con columnas: nombre, email, ciudad + acciones. `data-testid="clientes-table"`, cada fila `data-testid="cliente-row-{id}"`.
- **Búsqueda** por nombre: input `data-testid="clientes-search"` que filtra la tabla.
- **Crear**: botón `data-testid="cliente-crear"` → abre modal con form (nombre*, email, ciudad). Validación: nombre requerido. Guardar → POST /api/clientes → agrega a la tabla + toast. `data-testid`: `cliente-form-nombre`, `cliente-form-email`, `cliente-form-ciudad`, `cliente-form-guardar`, `cliente-form-cancelar`.
- **Editar**: por fila, botón `data-testid="cliente-editar-{id}"` → modal precargado → PUT /api/clientes/:id.
- **Eliminar**: botón `data-testid="cliente-eliminar-{id}"` → **modal de confirmación** (`data-testid="confirm-dialog"`, `confirm-ok`, `confirm-cancelar`) → DELETE.
- Toast de éxito/error (`data-testid="toast"`), estado vacío (`data-testid="clientes-empty"`), spinner de carga.
- Seed inicial: ~5 clientes.

### Pedidos (segunda entidad, mínima)
- Lista simple + crear (relacionado a un cliente vía select). Solo para tener navegación y una relación. Mínimo esfuerzo.

### Ajustes = PANEL DE FALLAS (el corazón de test)
Toggles que setean config global en el backend fake (POST /api/config). Cada uno cambia cómo responde `/api/*`:
- `fail-on-save`: los POST/PUT devuelven **HTTP 500** (con banner de error visible).
- `non-persisting-save`: el save responde 200 + toast de éxito, pero el dato NO queda (desaparece al re-buscar/recargar).
- `validation-rejects`: los guardados devuelven 422 con error de validación visible.
- `blocking-modal`: aparece un modal que tapa las acciones principales (hay que cerrarlo primero).
- `slow`: agrega ~3s de delay a las respuestas (spinner).
- Botón **Reset** (`data-testid="reset-data"`): restaura el seed.
Config también seteable por query param (`?fail=save` etc.) para automatización.

## 4. Criterios de aceptación (Fase 1)

1. `pnpm playground` levanta la app en :4700, un solo proceso.
2. Flujo del usuario funciona de punta a punta: **login → crear cliente 'Juan' → buscar 'Juan' → editar su nombre a 'Juan Pérez'** — con persistencia dentro de la sesión.
3. TODO elemento interactivo tiene `data-testid`.
4. El panel de Ajustes inyecta al menos: fail-on-save (500 real), non-persisting-save, validation-rejects, blocking-modal, slow + reset.
5. Typecheck y build del paquete pasan. No rompe el resto del monorepo.

## 5. No-alcance Fase 1

Roles/permisos, wizards multi-paso, upload, date pickers, drag-drop, tests, persistencia real → Fase 2/3.
