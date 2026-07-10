# Documentación de Ghostly

Índice de toda la documentación del proyecto. Convención: los documentos viven en esta carpeta; los README de paquetes (`packages/*/README.md`) se mantienen junto al paquete porque se publican en npm.

## Specs (diseño de versiones)

| Documento | Estado | Descripción |
|---|---|---|
| [ghostly-v0.2-trust-release.md](specs/ghostly-v0.2-trust-release.md) | 📐 Diseño aprobado | Spec de la próxima versión: fiabilidad del veredicto (percepción de errores, capa determinista, agente juez) + operación desatendida (CI, scheduling). |

## Arquitectura

| Documento | Estado | Descripción |
|---|---|---|
| [cursor-cli-llm-provider.md](cursor-cli-llm-provider.md) | ✅ Implementado | Diseño del módulo `llm/`: contrato `LlmProvider` con proveedores HTTP OpenAI-compatible y Cursor CLI. |
| [redaction-boundary.md](redaction-boundary.md) | ✅ Implementado | El único choke point de redacción de texto libre (goal/juez/página) antes de persistir o exponer — evita los leaks per-sink de GHOST-31. |

## Guías

| Documento | Estado | Descripción |
|---|---|---|
| [setup-new-machine.md](setup-new-machine.md) | ✅ Vigente | Setup de una máquina nueva: entorno AI completo (Ghostly + Cursor + Claude Code, MCP, skills). |

## Otros documentos del repo

- [readme.md](../readme.md) — presentación del producto, instalación, comandos y hoja de ruta.
- [CLAUDE.md](../CLAUDE.md) — convenciones del repo para agentes de IA (arquitectura, comandos, gotchas).
- [packages/cli/README.md](../packages/cli/README.md) — README publicado con el paquete `@ghostly-io/cli`.
