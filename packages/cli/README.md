# @ghostly-io/cli

Ghostly es una plataforma de testing E2E asistido por IA, enfocada en flujos reales de navegador con integración a Cursor vía MCP.  
Este paquete (`@ghostly-io/cli`) es la puerta de entrada para instalar, configurar y operar Ghostly localmente.

## Instalación

```bash
npm install -g @ghostly-io/cli
```

Comando principal:

```bash
ghostly --help
```

Alias compatible:

```bash
ghost --help
```

## Comandos principales del CLI

- `ghostly install` — configura `~/.ghostly/auth.json`, integra MCP en `~/.cursor/mcp.json`, instala Chromium y sincroniza reglas/skills globales.
- `ghostly config` — agrega o actualiza proveedor/modelo/api key/base URL de IA para modo asistido.
- `ghostly config --clear` — elimina configuración IA guardada.
- `ghostly keygen` — regenera API key local de Ghostly.
- `ghostly up` — prepara base de datos local y levanta servicios en `http://localhost:4000`.
- `ghostly update` — actualiza la instalación global del CLI.

## Proyecto Ghostly (visión general)

- Runtime local para ejecución de flujos E2E.
- Motor asistido para planificación/ejecución con proveedor IA configurable.
- Integración MCP con Cursor para usar herramientas Ghostly desde el chat.
- Dashboard/API local para monitoreo y operación.

## Requisitos

- Node.js `>=20`
- Cursor (para integración MCP y skills)

## Errores comunes y cómo resolverlos

- `**ERR_MODULE_NOT_FOUND` (runner u otros módulos)**  
Suele indicar instalación vieja/incompleta del CLI. Reinstala con la versión más reciente (`npm i -g @ghostly-io/cli@latest`) o con un `.tgz` recién generado.
- `**@prisma/client did not initialize yet`**  
El cliente Prisma no quedó generado en la instalación global. Actualiza a la versión más nueva del CLI y ejecuta `ghostly up` nuevamente.
- `**EEXIST ... ghost.cmd` / `ghostly` no reconocido**  
Hay conflicto de wrappers globales. Desinstala, limpia wrappers en `%APPDATA%/npm` y reinstala el CLI.

## Proyecto

- Repositorio: [https://github.com/Meza-dev/GhostTester-AI](https://github.com/Meza-dev/GhostTester-AI)

## Licencia

MIT