# Arquitectura

Lo leen el developer y el reviewer antes de tocar código, y el doc-writer lo actualiza cuando cambia
la estructura, el contrato IPC o una dependencia. Las decisiones con su porqué están en
`docs/adr/`; las reglas de cada zona, en el `CLAUDE.md` de su carpeta.

## Procesos

Tres procesos. Solo main accede a red, disco, procesos externos y secretos; la interfaz lo pide todo
por IPC (ADR-0002).

```
src/
  main/        Proceso main: único con acceso a red, disco, procesos y secretos
    ipc/         Registro de canales (handler.ts) y sus implementaciones (handlers/)
    security/    CSP, orígenes de confianza, navegación y rutas del protocolo app://
    dynatrace/   Cliente de Dynatrace, red y particiones por entorno
    db/          Esquema de SQLite (Drizzle) y migraciones
  preload/     Puente mínimo: expone window.vigia.invoke y nada más
  renderer/    Interfaz (React). No importa Electron ni Node
  shared/      Código común: identidad de la app, contrato IPC, razones de error
e2e/           Pruebas de extremo a extremo (Playwright sobre out/)
build/         Recursos de empaquetado
scripts/       Herramientas de desarrollo (e2e afectados, escaneo del tenant)
```

- `src/shared/ipc.ts`: contrato IPC. Cada canal tiene esquema Zod de entrada y de salida.
  TypeScript no compila si falta la implementación de un canal.
- `src/main/ipc/handler.ts`: envoltorio común de todos los canales (remitente de confianza,
  entrada, salida, errores sin detalle hacia el renderer). No importa Electron, para poder probarlo
  con Vitest.
- `src/main/ipc/handlers/`: implementaciones. Reciben sus dependencias de Electron inyectadas.
- `src/main/security/`: CSP, orígenes de confianza, navegación y rutas del protocolo `app://`.
- `src/preload/index.ts`: expone solo `window.vigia.invoke`. Nunca se entrega `ipcRenderer` a la
  interfaz.
- `src/renderer/`: React. No puede importar `electron`, `node:*` ni código de main o del preload (lo
  impide ESLint). Llama a main con `invoke()` de `src/renderer/src/lib/ipc.ts`.

Cómo añadir un canal IPC: ver el README.

## Principios

- Patrón para código nuevo de main: la lógica en módulos puros con tests, y el uso de Electron en
  una capa fina aparte.
- Main no traduce: los errores con texto para el usuario llevan `reason` (ADR-0005).
- Las vistas de datos no se refrescan solas: cada petición gasta cuota de la API (ADR-0004).
- La API de cada módulo (v1, v2 o plataforma) se deduce de `..\API\` y de la documentación
  oficial; la elección se anota en la ficha y, si es una decisión de módulo, en un ADR.
- Cada entorno tiene su partición de red; un cambio de certificados crea una nueva (ADR-0003).
- Contenido del tenant con formato (Markdown): solo con `MarkdownText`
  (`src/renderer/src/components/`), sin HTML en crudo, solo enlaces http/https y sin imágenes ni
  recursos remotos (ADR-0008).

## Datos

| Dato                                | Ubicación                                   |
| ----------------------------------- | ------------------------------------------- |
| Datos de la app (zip)               | `%APPDATA%\vigia\`                          |
| Datos en desarrollo (`npm run dev`) | `%APPDATA%\vigia-dev\`                      |
| Datos de cada e2e                   | Carpeta temporal (`VIGIA_USER_DATA_DIR`)    |
| Logs                                | `%APPDATA%\vigia\logs\main.log`             |
| Migraciones                         | `src/main/db/` → `resources/migrations` zip |

## Versiones fijadas

Electron 44.5.1, electron-vite 5.0.0, Vite 7.3.6, React 19.3.0, TypeScript 5.9.3, Zod 4.6.5,
electron-log 5.4.4, Vitest 5.0.3 (con @vitest/coverage-v8 5.0.3), Playwright 1.63.0,
electron-builder 26.15.3, ESLint 9.39.5, React Router 8.4.0, Zustand 5.0.15, i18next 26.4.2,
react-i18next 17.0.15, Tailwind CSS 4.3.3, Motion 14.0.0, cmdk 1.1.1, lucide-react 1.51.0,
better-sqlite3 13.0.3, Drizzle ORM 0.45.3, drizzle-kit 0.31.11, TanStack Query 5.104.1, TanStack
Virtual 3.14.13, react-hook-form 7.89.0, selfsigned 5.5.0 (solo tests), ExcelJS 4.4.0 (main),
ECharts 6.1.0, react-markdown 10.1.0 y remark-gfm 4.0.1 (renderer, ADR-0008). Node 22 o superior.

- Dependencias con versión exacta: `npm install --save-exact <paquete>`. Una dependencia nueva
  necesita ficha y, si es de main o cambia el empaquetado, ADR.
- Las librerías solo del renderer van en devDependencies: Vite las empaqueta y electron-builder
  metería en el asar todo lo de dependencies.
- electron-vite 5 no admite Vite 8. No subir Vite, TypeScript (7) ni ESLint (10) sin comprobar la
  compatibilidad de electron-vite y de typescript-eslint.
- better-sqlite3 13 trae binarios precompilados N-API dentro del paquete: no hace falta recompilar
  ni `electron-builder install-app-deps`, y funciona igual en Vitest y en Electron. En el zip va
  fuera del asar (`asarUnpack`) y solo con el binario win32-x64.

`npm audit` (2026-10-04): 14 avisos en total (6 moderados y 8 altos), todos de herramientas de
desarrollo o empaquetado (http-cache-semantics vía `@electron/get`, `esbuild` vía `drizzle-kit`,
`uuid`) salvo dos. `npm audit --omit=dev` da 2 moderados: `uuid` anterior a 11.1.1
(GHSA-w5hq-g745-h8pq) a través de ExcelJS 4.4.0. No es alcanzable: el fallo está en `v3`, `v5` y
`v6` con `buf`, y ExcelJS solo usa `v4`. No forzar overrides; revisar al subir ExcelJS o
electron-builder. Deuda anotada: npm marca ESLint 9.39.5 como sin soporte (no subir a 10 sin
typescript-eslint y electron-vite compatibles).
