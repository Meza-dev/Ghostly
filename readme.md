# Ghostly

Automated E2E Testing Engine for Modern Development Workflows.

Ghostly es un motor de pruebas E2E **local-first y asistido por IA**. A partir de un objetivo en lenguaje natural, genera y ejecuta flujos de navegador con Playwright de forma autónoma, repara selectores fallidos (self-healing) y transmite el progreso en vivo a un dashboard web. Se distribuye como CLI global de npm (`ghostly`, alias legado `ghost`) bajo el scope `@ghostly-io`.

## 🛠 Instalación

```bash
npm install -g @ghostly-io/cli
```

Los paquetes npm se publican bajo la organización **`@ghostly-io`**. El comando de la CLI es **`ghostly`** (se mantiene el alias `ghost` por compatibilidad).

## 🏗 Arquitectura y funcionamiento

Ghostly opera como un runtime local compuesto por varios servicios:

1. **CLI (`ghostly`)**: instala, configura y levanta el motor en la máquina del desarrollador.
2. **API de orquestación** (`apps/api`): recibe el objetivo del test, envuelve al proveedor de IA (strategist/healer) y persiste runs, pasos y eventos en SQLite (Prisma).
3. **Runner** (`packages/runner`): motor de ejecución Playwright. Corre el pipeline asistido — planifica en horizontes, ejecuta pasos, observa la página tras cada acción y repara selectores fallidos.
4. **Dashboard web** (`apps/web`): visualización de runs en vivo (SSE), detalle de pasos, artefactos (screenshots, video, trazas) y configuración del proveedor LLM.
5. **Servidor MCP** (`packages/mcp-server`): expone las herramientas de Ghostly (`ghostly_run_flow`, project map, submit plan) a IDEs compatibles como Cursor.
6. **Scanner** (`packages/scanner`): análisis estático (AST) del repo objetivo para generar el mapa de rutas y componentes que alimenta la planificación.

El proveedor de IA es configurable (BYO-LLM): cualquier endpoint HTTP compatible con OpenAI o un CLI local (p. ej. Cursor CLI). Ver `docs/cursor-cli-llm-provider.md`.

## 📑 Comandos de referencia

| Comando           | Descripción técnica                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `ghostly keygen`  | Inicializa el sistema de criptografía local y genera las credenciales de identidad.                 |
| `ghostly install` | Implementa el servidor MCP en el entorno de desarrollo (IDE), instala Chromium y sincroniza reglas.  |
| `ghostly config`  | Configura proveedor/modelo/API key/base URL de IA para el modo asistido (`--clear` para limpiar).    |
| `ghostly up`      | Prepara la base de datos local y levanta el motor de ejecución y la API en `http://localhost:4000`.  |
| `ghostly update`  | Actualiza la instalación global de la CLI.                                                           |

## 🔒 Privacidad y seguridad (local-first)

Ghostly ha sido diseñado bajo un modelo de seguridad de confianza cero y arquitectura local:

- **Generación local de claves**: todas las claves criptográficas y secretos de API se gestionan en el almacenamiento seguro del host local.
- **Aislamiento de datos**: la lógica de ejecución y el procesamiento de pruebas no requieren la exfiltración de código fuente a nubes externas.
- **Cumplimiento**: ideal para entornos con normativas estrictas de seguridad donde el código debe permanecer dentro del perímetro del desarrollador.

## 📋 Requisitos del sistema

- **Runtime**: Node.js v20 o superior.
- **Entorno**: IDE compatible con protocolo MCP (ej. Cursor) para la integración de herramientas.
- **Dependencias de sistema**: Chromium (gestionado automáticamente vía Playwright).

## 📚 Documentación

Toda la documentación del proyecto vive en [`docs/`](docs/README.md):

- [Índice de documentación](docs/README.md)
- [Spec: Ghostly v0.2 — Trust Release](docs/specs/ghostly-v0.2-trust-release.md)
- [Setup de una máquina nueva](docs/setup-new-machine.md)
- [Arquitectura del proveedor LLM (HTTP / Cursor CLI)](docs/cursor-cli-llm-provider.md)

## ✅ Implementado

- **Pipeline asistido**: planificación por horizontes con strategist + observer + healer (self-healing de selectores).
- **Veredictos veraces**: victoria verificada por el motor (no declarada por la IA) + agente juez con taxonomía de 6 veredictos, agrupada de cara al usuario en 3 estados (Éxito / Fallo / Fallo de Ghostly) y con un resumen del run en lenguaje natural.
- **Percepción de errores**: captura estructurada de errores de consola, red (4xx/5xx) y alerts/toasts en el observer, con circuit breaker de errores bloqueantes.
- **Dashboard web bilingüe (EN/ES)**: overview, runs en vivo (SSE), detalle de run con hilo unificado de pasos + artefactos (screenshots, video, trazas), settings y panel LLM.
- **Re-ejecución**: replay del plan existente, y re-ejecución cambiando datos o anexando instrucciones al objetivo.
- **Memoria de flujos** (`AssistMemory`): los runs exitosos se reutilizan para acelerar y estabilizar corridas futuras.
- **Proveedor LLM configurable**: HTTP OpenAI-compatible o CLI local, por usuario.
- **Grabación de video configurable** y **auto-update**: el dashboard detecta versiones nuevas y actualiza con un click.
- **Integración MCP**: herramientas Ghostly disponibles desde el IDE.

## 🗺 Hoja de ruta

La **v0.2 "Trust Release"** (fiabilidad del veredicto: capa determinista + agente juez + redacción de secretos) ya está en `main`. Ver el [spec](docs/specs/ghostly-v0.2-trust-release.md). Próximos pasos:

- **Auto-restart tras update**: que el botón reinicie el motor solo (estilo Claude Desktop), sin el paso manual de `ghostly up`.
- **Atribución de victoria diff-based**: exigir que la evidencia de éxito la haya causado este run (cortar falsos éxitos por datos residuales).
- **Orquestación CI/CD**: modo `--ci` con exit codes y reporte JSON/JUnit; scheduling local; webhooks Git.
- **Vocabulario de acciones**: verbos restantes (`check`/`uncheck`, `hover`, `setInputFiles`, diálogos nativos, etc.).
- **Parametrización (fase 2)**: variables con nombre reutilizables entre runs.
- **Import/export de runs**: mover el historial entre máquinas.

## ⚖️ Licencia

Este proyecto está bajo la licencia MIT. Consulte el archivo `LICENSE` para obtener más detalles.
