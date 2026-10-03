# Registro de cambios

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[versionado semántico](https://semver.org/lang/es/).

## [Sin publicar]

Fase 2: esqueleto de la interfaz.

### Añadido

- Layout completo: barra lateral plegable con los grupos Monitorización, Análisis y
  Administración, barra superior con la ruta de la sección, búsqueda y cambio rápido de tema e
  idioma, y barra de título propia que conserva los botones nativos de Windows.
- Lista única de secciones (`src/renderer/src/app/navigation.ts`), de la que salen el menú, las
  rutas hash y la paleta de comandos `Ctrl+K`.
- Secciones vacías con su cabecera y pantalla de Ajustes con tema e idioma.
- Tema cristal con tokens CSS (Tailwind CSS v4): Claro, Oscuro y Sistema, que sigue en caliente a
  `prefers-color-scheme`; main ajusta `nativeTheme` para la barra de título.
- Idiomas español e inglés con i18next; la regla `i18next/no-literal-string` impide textos sin
  traducir en la interfaz.
- Transiciones de página con Motion y de la barra lateral con CSS, que respetan
  `prefers-reduced-motion`.
- Tarjeta de estado del entorno en el pie de la barra lateral, con un estado neutro mientras no
  haya entornos.
- La variable `VIGIA_USER_DATA_DIR` fija la carpeta de datos en pruebas; se ignora en la app
  empaquetada.

### Cambiado

- `docs/glosario.md`: se quita "Dynatrace Hub", que la app no usa.

## [0.1.0] - 2026-10-03

Fase 1: base del proyecto.

### Añadido

- Proyecto Electron + React + TypeScript generado con electron-vite, con las carpetas
  `src/main`, `src/preload`, `src/renderer` y `src/shared`.
- Contrato IPC tipado y validado con Zod (`src/shared/ipc.ts`), con los canales de ejemplo
  `app:getInfo` y `app:ping`.
- Ventana con `contextIsolation`, `sandbox` y sin `nodeIntegration`; preload empaquetado en un
  único fichero.
- Protocolo propio `app://vigia/` para servir la interfaz, con CSP estricta en cada respuesta.
- Comprobación del remitente de cada mensaje IPC, navegación externa bloqueada y permisos web
  denegados.
- Instancia única.
- User-Agent solo con caracteres ASCII (`vigia/<versión>`).
- Logs en fichero rotado con electron-log en `%APPDATA%\vigia\logs`.
- ESLint, Prettier, Vitest (tests unitarios) y Playwright (prueba de extremo a extremo).
- Empaquetado con electron-builder: zip para Windows x64 y portable como opción secundaria,
  con fusibles de Electron.
