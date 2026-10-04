# Vigía

App de escritorio para Windows (Electron + React + TypeScript) para trabajar con Dynatrace.
No afiliada ni respaldada por Dynatrace.

Estado: **v0.7.0**. Inicio, Problemas y Métricas contra la API clásica de Dynatrace, con
exportación (CSV, XLSX, TXT) y capturas; clientes, entornos y credenciales cifradas en local. Ver
`CHANGELOG.md`.

## Requisitos

- Windows 10 u 11 de 64 bits.
- Node.js 22 o superior (solo para desarrollar y empaquetar; la app empaquetada no lo necesita).

## Puesta en marcha

```powershell
npm ci --ignore-scripts
npm run dev
```

Electron (unos 100 MB) se descarga la primera vez que se usa (`npm run dev`, `npm run build` o los
e2e).

**Por qué `--ignore-scripts`:** better-sqlite3 trae sus binarios precompilados (N-API) y no hace
falta compilar nada, pero `npm ci` (con npm 10 y con npm 11) intenta `node-gyp rebuild` porque el
`package-lock.json` no guarda que el paquete declara `"gypfile": false`, y falla si no hay Visual
Studio con C++. Añadir ese campo al lockfile a mano no sirve: `npm install` lo borra. Ningún otro
paquete de Windows necesita sus scripts de instalación (Electron 44 descarga su binario al usarse),
así que `--ignore-scripts` deja el entorno completo. Comprobado el 2026-10-04 en un clon limpio con
Node 22.22 y npm 10.9 y 11.21: tests de main con better-sqlite3 y `electron-vite build`.

## Comandos

| Comando                     | Qué hace                                              |
| --------------------------- | ----------------------------------------------------- |
| `npm run dev`               | Arranca la app en desarrollo, con recarga en caliente |
| `npm run check`             | Lint, tipos, formato y tests con umbral de cobertura  |
| `npm test`                  | Tests unitarios (Vitest)                              |
| `npm run test:e2e`          | Compila y prueba la app de punta a punta (Playwright) |
| `npm run build`             | Comprueba tipos y compila a `out/`                    |
| `npm run dist:win`          | Genera `dist/vigia-<versión>-win-x64.zip`             |
| `npm run dist:win:portable` | Genera el ejecutable portable (opción secundaria)     |
| `npm run format`            | Formatea el código con Prettier                       |

El zip se descomprime en cualquier carpeta y se ejecuta `vigia.exe`; no hay instalador.

Si al empaquetar en Windows aparece un error sobre enlaces simbólicos ("A required privilege is
not held by the client"), activa el Modo de desarrollador de Windows o lanza la terminal como
administrador y repite el comando.

## Estructura

```
src/
  main/        Proceso main: único con acceso a red, disco, procesos y secretos
    ipc/         Registro de canales y sus implementaciones
    security/    CSP, orígenes de confianza, navegación y rutas del protocolo
  preload/     Puente mínimo: expone window.vigia.invoke y nada más
  renderer/    Interfaz (React). No importa Electron ni Node
  shared/      Código común: identidad de la app y contrato IPC
e2e/           Pruebas de extremo a extremo
build/         Recursos de empaquetado (icono provisional)
```

## Cómo se comunican la interfaz y main

La interfaz solo puede llamar a los canales declarados en `src/shared/ipc.ts`. Cada canal tiene
un esquema Zod de entrada y otro de salida.

Para añadir un canal:

1. Declararlo en `ipcContract` (`src/shared/ipc.ts`).
2. Implementarlo en `src/main/ipc/handlers/` y añadirlo en `src/main/index.ts`. TypeScript no
   compila si falta la implementación de algún canal.
3. Llamarlo desde la interfaz con `invoke('ámbito:acción', entrada)` (`src/renderer/src/lib/ipc.ts`).

Main comprueba en cada mensaje que el remitente es la ventana de la app, valida la entrada,
valida la salida y nunca devuelve al renderer el detalle de un error interno.

## Seguridad

- Ventana con `contextIsolation`, `sandbox` y sin `nodeIntegration`.
- La interfaz se sirve por el protocolo propio `app://vigia/`, no por `file://`.
- CSP estricta definida en `src/main/security/csp.ts`; en desarrollo solo se relaja lo que
  necesita la recarga en caliente de Vite.
- Navegación fuera de la app y ventanas nuevas bloqueadas; los enlaces http/https se abren en el
  navegador del sistema.
- Permisos web (cámara, micrófono, ubicación…) denegados.
- Instancia única: una segunda ejecución enfoca la ventana ya abierta.
- Fusibles de Electron en el ejecutable empaquetado (`electron-builder.yml`).

## Datos en el equipo

| Dato                                | Ubicación                       |
| ----------------------------------- | ------------------------------- |
| Datos de la app                     | `%APPDATA%\vigia\`              |
| Logs                                | `%APPDATA%\vigia\logs\main.log` |
| Datos en desarrollo (`npm run dev`) | `%APPDATA%\vigia-dev\`          |

Regla del proyecto: nunca se escriben secretos, cabeceras `Authorization` ni cookies en logs,
ficheros de configuración, mensajes de error ni en el repositorio.

## Versiones

Todas las dependencias están fijadas a una versión exacta (`.npmrc` con `save-exact`) y el
`package-lock.json` forma parte del proyecto.
