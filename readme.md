# Ghostly

Automated E2E Testing Engine for Modern Development Workflows.

Ghostly es una plataforma de automatización de pruebas diseñada para integrarse en el ciclo de vida del desarrollo de software (SDLC) sin fricciones. Utiliza inteligencia artificial para la generación de pruebas y ejecución autónoma, permitiendo a los equipos de ingeniería mantener una alta velocidad de despliegue con garantías de regresión total.

## 🛠 Instalación

Ghostly se distribuye como un paquete global de Node.js a través del registro de NPM.

```bash
npm install -g @ghostly-io/cli
```

Los paquetes npm se publican bajo la organización **`@ghostly-io`**. El comando de la CLI es **`ghostly`** (se mantiene el alias `ghost` por compatibilidad).

## 🏗 Arquitectura y Funcionamiento

Ghostly opera de forma asíncrona y no intrusiva dentro del entorno local del desarrollador:

1. **Análisis de Cambios**: Monitorea el sistema de archivos para detectar mutaciones en el código fuente.
2. **Planificación Dinámica**: Genera un plan de ejecución basado en el impacto de los cambios detectados.
3. **Ejecución Autónoma**: Ejecuta flujos de prueba mediante Playwright de manera transparente.
4. **Persistencia de Artefactos**: Genera documentación técnica automática, incluyendo trazas de red, logs de consola y evidencias visuales (video/capturas).

## 📑 Comandos de Referencia


| Comando         | Descripción Técnica                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `ghostly keygen`  | Inicializa el sistema de criptografía local y genera las credenciales de identidad.                |
| `ghostly install` | Implementa el servidor de protocolo de contexto de modelo (MCP) en el entorno de desarrollo (IDE). |
| `ghostly up`      | Inicializa el motor de ejecución y los servicios de orquestación local.                            |


## 🔒 Privacidad y Seguridad (Local-First)

Ghostly ha sido diseñado bajo un modelo de seguridad de confianza cero y arquitectura local:

- **Generación Local de Claves**: Todas las claves criptográficas y secretos de API se gestionan en el almacenamiento seguro del host local.
- **Aislamiento de Datos**: La lógica de ejecución y el procesamiento de pruebas no requieren la exfiltración de código fuente a nubes externas.
- **Cumplimiento**: Ideal para entornos con normativas estrictas de seguridad donde el código debe permanecer dentro del perímetro del desarrollador.

## 📋 Requisitos del Sistema

- **Runtime**: Node.js v18.0.0 o superior (v20.x recomendado).
- **Entorno**: IDE compatible con protocolo MCP (ej. Cursor).
- **Dependencias de Sistema**: Chromium Browser (gestionado automáticamente vía Playwright).

## 🗺 Hoja de Ruta (MVP)

- **Orquestación CI/CD**: Integración mediante Webhooks con proveedores de Git (GitHub/GitLab).
- **Motor AI Proactivo**: Algoritmos de "Self-healing" para la reparación automática de selectores en pruebas fallidas.
- **Dashboard Analítico**: Interfaz de visualización de métricas de cobertura y estados de salud del proyecto.
- **Agregación de Flujos**: Ejecución de lotes de pruebas con agregación de resultados jerárquica.

## ⚖️ Licencia

Este proyecto está bajo la licencia MIT. Consulte el archivo `LICENSE` para obtener más detalles.