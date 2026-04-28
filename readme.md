# GhostTester AI: Autonomous Agentic QA

**GhostTester AI** es una plataforma de testing autónomo que utiliza agentes de Inteligencia Artificial para simular el comportamiento de un usuario real. A diferencia de las herramientas de testing tradicionales que dependen de scripts rígidos (como Cypress o Selenium manual), GhostTester entiende el propósito del código y navega por la interfaz de forma lógica.

## 🚀 Visión General
El sistema detecta automáticamente qué cambios se han realizado en el código, genera un plan de pruebas coherente y ejecuta la navegación en un navegador real, reportando errores con contexto visual y técnico detallado.

---

## 🧠 Arquitectura de IA (Multi-Model Workflow)
Para maximizar la eficiencia y reducir el consumo de tokens, el proyecto utiliza un flujo de trabajo de modelos especializados:

| Fase | Agente | Modelo | Rol |
| :--- | :--- | :--- | :--- |
| **1. Detección** | Change Analyzer | `gpt-4o-mini` | Analiza el `git diff` para identificar áreas afectadas. |
| **2. Estrategia** | Test Architect | `claude-3-5-sonnet` | Crea el plan de pasos lógicos y casos de prueba. |
| **3. Ejecución** | Action Agent | `gpt-4o-mini` | Interactúa con el DOM (via Accessibility Tree) y navega. |
| **4. Diagnóstico** | Visual Debugger | `gpt-4o` (Vision) | Analiza capturas de pantalla solo cuando detecta un error. |

---

## 🛠 Stack Tecnológico

### Core & Orchestration
* **Lenguaje:** TypeScript (Node.js).
* **Orquestador de Agentes:** [LangGraph](https://www.langchain.com/langgraph) (para flujos de trabajo cíclicos y persistencia de estado).
* **Automatización:** [Playwright](https://playwright.dev/) (superior en velocidad y recolección de trazas/artefactos).

### Backend & Data
* **Base de Datos:** PostgreSQL (con Prisma) para reportes, logs e historial.
* **Cola de Tareas:** BullMQ con Redis para gestionar ejecuciones asíncronas tras cada deploy.

### Frontend (Dashboard)
* **Framework:** Next.js (App Router).
* **UI:** Tailwind CSS + Shadcn/ui.
* **Real-time:** WebSockets (Socket.io) para visualizar la ejecución del agente en vivo.

---

## 🔄 Flujo del Sistema

1.  **Trigger:** Se activa mediante un Webhook de GitHub (al hacer PR/Push) o manualmente desde el Dashboard.
2.  **Análisis de Código:** La IA lee los cambios. *Ejemplo: "Se modificó el componente de recuperación de contraseña".*
3.  **Generación del Plan:** El Agente Arquitecto define: *"Debo ir a /login, clickear en 'olvidé mi clave', ingresar un correo y verificar el mensaje de éxito".*
4.  **Navegación Inteligente:** El Agente Ejecutor usa **Playwright**. En lugar de enviar HTML pesado, utiliza el **Accessibility Tree** (JSON ligero) para identificar elementos, ahorrando un 80% en tokens.
5.  **Generación de Reporte:** El sistema guarda:
    * Video de la sesión (.mp4).
    * Capturas de pantalla de cada paso.
    * Logs de consola y red.
    * Explicación del error en lenguaje natural si la prueba falla.

---

## 💡 Estrategias de Ahorro y Optimización
* **Self-Healing:** Si un selector cambia (ej: de `#btn-submit` a `#enviar`), la IA lo reconoce por contexto y no rompe el test, sugiriendo la actualización en el reporte.
* **Captura Selectiva:** Solo se invocan modelos de visión costosos cuando el Agente Ejecutor encuentra un bloqueo o una discrepancia visual.
* **Caching de Rutas:** La IA memoriza flujos comunes (como el Login) para ejecutarlos más rápido en pruebas subsecuentes sin re-planificar.

---

## Contexto de Código vía MCP

GhostTester puede generar un `ghost-manifest.json` para que el MCP server entregue contexto estructural del código antes de planificar o sanar una corrida.

```bash
pnpm run scan -- --root . --out ghost-manifest.json --base-url http://localhost:5173
```

El scanner usa AST de TypeScript/TSX para detectar rutas, componentes, `data-testid`, `aria-label`, roles y formularios. Ignora `node_modules`, builds (`dist`, `.next`) y tests (`*.spec.*`, `*.test.*`) para evitar ruido. El manifest incluye `gitCommit`; si el MCP detecta que el manifest fue generado con otro commit, avisa que hay que ejecutar `ghost-scan` de nuevo.

Configuración opcional en `ghosttester.config.json`:

```json
{
  "baseUrl": "http://localhost:5173",
  "flowDocsDir": "docs/flows",
  "manifestPath": "ghost-manifest.json"
}
```

Los documentos de flujo viven por defecto en `docs/flows/*.ghost.md`:

```md
# Flow: login

## Goal
Iniciar sesión y llegar al dashboard.

## Steps (hint)
1. Ir a /login
2. Llenar [data-testid="email-input"]
3. Llenar [data-testid="password-input"]
4. Click en [data-testid="login-button"]

## Success criteria
- URL contiene /dashboard
```

El MCP server expone `get_project_map`, `analyze_component`, `read_flow_docs` y `submit_plan` para consumir ese contexto y enviar planes enriquecidos a `POST /v1/run`.

---

## 📅 Roadmap MVP
- [ ] Integración de Webhooks con GitHub/GitLab.
- [ ] Motor de ejecución Agente + Playwright.
- [ ] Dashboard de visualización con estados (Pass/Fail/Error).
- [ ] Generación automática de artefactos (video y capturas).
- [ ] Implementación de "Auto-fix" para sugerencias de cambios en el código de tests.