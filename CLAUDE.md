# Vigía — instrucciones para Claude

App de escritorio para Windows (Electron + React + TypeScript) para trabajar con Dynatrace: core de Dynatrace con mejor presentación, más backups y migración de configuración con Monaco. El dueño del proyecto es Dani; se le responde en español.

## Documentos

- `docs/especificacion.md`: la especificación completa (stack, seguridad, autenticación, Monaco, interfaz, plan de once fases y decisiones pendientes). **Leer la sección de la fase en curso antes de escribir código.** Es la copia de trabajo: al cerrar una decisión pendiente, se marca ahí.
- `README.md`: comandos, estructura y cómo añadir un canal IPC.
- `CHANGELOG.md`: se actualiza en cada fase.
- `..\API\`: especificaciones OpenAPI de Dynatrace (Configuration API, Environment API v1 y v2, y APIs de plataforma). Son la fuente de verdad de endpoints, parámetros y scopes. Son ficheros grandes: buscar en ellos, no leerlos enteros.

## Estado actual

Última actualización: 2026-10-03.

- **Fase 1 (base del proyecto): entregada, versión 0.1.0.** Criterios automáticos cumplidos; criterios manuales pendientes de Dani.
- **Siguiente: Fase 2 (esqueleto de la interfaz).** No empezar hasta que Dani confirme la Fase 1.
- El proyecto todavía no es un repositorio git.
- El código se escribió y se probó en Linux. **Nunca se ha ejecutado en Windows.**

Lo que se comprobó de la Fase 1 (en Linux): lint, tipos, 21 tests unitarios, 9 tests de extremo a extremo sobre la app compilada, `npm run dev` sin errores en consola, generación del zip de Windows y arranque de la app empaquetada (build de Linux).

Pendiente de Dani (aceptación manual de la Fase 1):

- [ ] `npm run dev` abre la ventana en Windows.
- [ ] El zip (`npm run dist:win`) arranca en un PC sin Node.
- [ ] El zip arranca en un PC corporativo (SmartScreen, AppLocker).

## Primer paso al retomar

1. `npm install`, y después `npm run check` y `npm run test:e2e`. Es la primera ejecución en Windows: si algo falla, arreglarlo antes de seguir.
2. `git init` y un commit inicial con el estado de la Fase 1, si Dani está de acuerdo.
3. Preguntar a Dani el resultado de la aceptación manual de la Fase 1.
4. Antes de la Fase 2, preguntar las decisiones pendientes que le afectan: **Terminología** (conceptos de Dynatrace en inglés en ambos idiomas) y **Perfiles** (vistas adaptadas, no permisos).

## Reglas de trabajo

- Una fase cada vez. Al terminarla, parar para que Dani la pruebe en su PC.
- Las decisiones pendientes de la especificación las toma Dani: preguntar cuando una fase las necesite, no suponerlas.
- Un criterio de aceptación manual no se da por cumplido; solo lo confirma Dani.
- No inventar endpoints ni parámetros de Dynatrace o de Monaco: consultar `..\API\` y la documentación oficial.
- Nunca escribir secretos, cabeceras `Authorization` ni cookies en logs, ficheros de configuración, mensajes de error ni en el repositorio.
- Sin definición cerrada no se implementan: Service flows avanzados, Vista de negocio, notificaciones, Favoritos y variación de los KPI.
- Commits pequeños por funcionalidad, con tests para la lógica de main.
- Dependencias con versión exacta: `npm install --save-exact <paquete>`.
- Comentarios, textos de interfaz y documentación en español; identificadores en inglés.
- Al cerrar una fase: actualizar "Estado actual" de este fichero, `CHANGELOG.md` y, si cambia algo de lo acordado, `docs/especificacion.md`.

## Comandos

| Comando            | Qué hace                                              |
| ------------------ | ----------------------------------------------------- |
| `npm run dev`      | App en desarrollo con recarga en caliente             |
| `npm run check`    | Lint, tipos y tests unitarios                         |
| `npm run test:e2e` | Compila y prueba la app de punta a punta (Playwright) |
| `npm run build`    | Tipos y compilación a `out/`                          |
| `npm run dist:win` | Zip de Windows en `dist/`                             |
| `npm run format`   | Prettier                                              |

Antes de dar una tarea por terminada: `npm run check`, `npm run test:e2e` y `npm run format:check`.

## Arquitectura

Tres procesos. Solo main accede a red, disco, procesos externos y secretos; la interfaz lo pide todo por IPC.

- `src/shared/ipc.ts`: contrato IPC. Cada canal tiene esquema Zod de entrada y de salida. TypeScript no compila si falta la implementación de un canal.
- `src/main/ipc/handler.ts`: envoltorio común de todos los canales (remitente de confianza, entrada, salida, errores sin detalle hacia el renderer). No importa Electron, para poder probarlo con Vitest.
- `src/main/ipc/handlers/`: implementaciones. Reciben sus dependencias de Electron inyectadas.
- `src/main/security/`: CSP, orígenes de confianza, navegación y rutas del protocolo `app://`.
- `src/preload/index.ts`: expone solo `window.vigia.invoke`. Nunca se entrega `ipcRenderer` a la interfaz.
- `src/renderer/`: React. No puede importar `electron`, `node:*` ni código de main o del preload (lo impide ESLint). Llama a main con `invoke()` de `src/renderer/src/lib/ipc.ts`.

Patrón para código nuevo de main: la lógica en módulos puros con tests, y el uso de Electron en una capa fina aparte.

## Cosas que ya se aprendieron

- **La tilde de "Vigía" no puede acabar en una cabecera HTTP ni en una ruta.** Electron mete el nombre de la app en el User-Agent y eso rompía el protocolo `app://`. Está resuelto en `src/main/user-agent.ts`. Para todo lo técnico se usa `vigia`.
- `URL.origin` devuelve `"null"` para `app://`. Los orígenes se comparan con `originOf` (`src/main/security/origins.ts`).
- El preload corre en sandbox y solo puede cargar `electron`, `events`, `timers` y `url`. Por eso `electron.vite.config.ts` tiene `externalizeDeps: false` en el preload.
- La CSP se envía como cabecera, no como etiqueta `meta`: en producción la pone el protocolo `app://` y en desarrollo `hardenDefaultSession`. Cualquier ampliación se anota en `src/main/security/csp.ts` con su motivo; nunca `unsafe-eval` ni orígenes remotos.
- Los permisos web están denegados para todo (`src/main/security/harden.ts`). Si una fase necesita uno (por ejemplo, portapapeles desde la interfaz), se concede ahí de forma explícita.
- Con los fusibles de Electron activos, Playwright no puede adjuntarse a la app empaquetada. Las pruebas e2e corren sobre `out/`, sin empaquetar.
- electron-vite 5 no admite Vite 8. No subir Vite, TypeScript (7) ni ESLint (10) sin comprobar la compatibilidad de electron-vite y de typescript-eslint.
- better-sqlite3 13 trae binarios precompilados N-API dentro del paquete: en la Fase 3 no hace falta recompilar ni `electron-builder install-app-deps`.
- En producción no hay menú (`Menu.setApplicationMenu(null)`), así que tampoco hay atajos de recarga ni DevTools.
- Si `npm run dist:win` falla en Windows con un error de enlaces simbólicos, hace falta el Modo de desarrollador de Windows o una terminal de administrador.

## Versiones fijadas

Electron 44.5.1, electron-vite 5.0.0, Vite 7.3.6, React 19.3.0, TypeScript 5.9.3, Zod 4.6.5, electron-log 5.4.4, Vitest 5.0.3, Playwright 1.63.0, electron-builder 26.15.3, ESLint 9.39.5. Node 22 o superior.
