# Vigía — instrucciones para Claude

App de escritorio para Windows (Electron + React + TypeScript) para trabajar con Dynatrace: core de Dynatrace con mejor presentación y funciones propias (backups y migración con Monaco, aparcados por ahora). El dueño del proyecto es Dani; se le responde en español.

## Documentos

- `docs/especificacion.md`: la especificación completa (stack, seguridad, autenticación, Monaco, interfaz, plan de once fases, con la 5 y la 7 (Monaco) aparcadas, y decisiones pendientes). **Leer la sección de la fase en curso antes de escribir código.** Es la copia de trabajo: al cerrar una decisión pendiente, se marca ahí. Documento local, no versionado (en `.gitignore`); no buscarla ni recrearla si falta en un clon.
- `docs/glosario.md`: términos de Dynatrace que se escriben igual en español y en inglés.
- `README.md`: comandos, estructura y cómo añadir un canal IPC.
- `CHANGELOG.md`: se actualiza en cada fase.
- `..\API\`: especificaciones OpenAPI de Dynatrace (Configuration API, Environment API v1 y v2, y APIs de plataforma). Son la fuente de verdad de endpoints, parámetros y scopes. Son ficheros grandes: buscar en ellos, no leerlos enteros.

## Estado actual

Última actualización: 2026-10-03.

- **Fase 1 (base del proyecto): aceptada, versión 0.1.0.** Criterios automáticos y manuales cumplidos; los manuales los comprobó Dani en Windows.
- **Fase 2 (esqueleto de la interfaz): cerrada, versión 0.2.0.** Criterios automáticos cumplidos (check 54 tests, e2e 29 tests, en Windows); la aceptación manual está en la lista de pendientes.
- **Fase 3 (datos locales y secretos): cerrada, versión 0.3.0.** Criterios automáticos cumplidos en Windows (check y e2e, con relanzamiento de la app); la aceptación manual está en la lista de pendientes.
- **Fase 4 (cliente de Dynatrace): cerrada, versión 0.4.0.** Criterios automáticos cumplidos en Windows (unitarios, integración con un HTTPS simulado y e2e de certificados); la prueba contra un tenant real está en la lista de pendientes.
- **Fase 6 (primeras vistas core): cerrada, versión 0.6.0.** Con ella se completa el alcance propuesto de la primera versión (fases 1, 2, 3, 4 y 6). Criterios automáticos cumplidos en Windows; la aceptación manual está en la lista de pendientes.
- **Siguiente:** lo decide Dani (Monaco sigue aparcado).
- **Alcance propuesto de la primera versión: fases 1, 2, 3, 4 y 6** (sin confirmar). Monaco (fases 5 y 7) está aparcado: no se implementa ni se pregunta por él hasta que Dani lo retome.
- Repositorio git local. Remoto público: https://github.com/Danik0rZz/Vigia.
- El código se escribió y se probó en Linux. Dani ha comprobado a mano la Fase 1 en Windows, y `npm run check` y `npm run test:e2e` pasan en Windows (2026-10-03).

Lo que se comprobó de la Fase 1 (en Linux): lint, tipos, 21 tests unitarios, 9 tests de extremo a extremo sobre la app compilada, `npm run dev` sin errores en consola, generación del zip de Windows y arranque de la app empaquetada (build de Linux).

Aceptación manual de la Fase 1 (comprobada por Dani en Windows):

- [x] `npm run dev` abre la ventana en Windows.
- [x] El zip (`npm run dist:win`) arranca en un PC sin Node.
- [x] El zip arranca en un PC corporativo (SmartScreen, AppLocker).

### Pendiente de Dani (aceptación manual)

No bloquea: se sigue con la fase siguiente y Dani lo prueba cuando pueda.

Dani aceptó la v0.6.0 el 2026-10-04 (cliente y entorno que se conservan al reiniciar) y dio por cumplidos los criterios manuales de las fases 2, 3, 4 y 6. "Probar conexión contra un tenant real" queda cubierto por las pruebas en vivo (`npm run test:live`, v0.7.0), y "XLSX y CSV en Excel" se revisa con las exportaciones reales de esas pruebas.

Fase 2:

- [x] Se navega por todas las secciones (vacías) en ambos idiomas y temas.
- [x] La barra de título propia funciona: se arrastra la ventana y los botones nativos siguen al tema.
- [x] El tema cristal se lee bien en claro y en oscuro.
- Sin probar: el material nativo de Windows 11 (`backgroundMaterial: 'mica'`), que es opcional.

Fase 3:

- [x] Crear un cliente y un entorno real, guardar un token y comprobar que tras reiniciar sigue "Configurado" y el entorno sigue activo.
- [x] Exportar la configuración, importarla en otro PC (o en una carpeta de datos vacía) y comprobar el resumen.
- [x] Con el tema "Oscuro" y Windows en claro, la barra de título ya no parpadea al arrancar.

Fase 4:

- [x] "Probar conexión" funciona contra un tenant real con token clásico (y, si se usa, OAuth y platform token), y avisa de los scopes que faltan.
- [x] Detrás del proxy corporativo y con su CA: con el nivel "sistema" conecta sin tocar nada.
- [x] La tarjeta del pie muestra el estado real y la caducidad del token OAuth.
- [x] Arrancar el zip 0.4.0 sobre sus datos: aplica la migración 0001 sin perder clientes, entornos ni credenciales.

Fase 6:

- [x] El XLSX se abre en Excel con los tipos correctos (fechas y números) y el CSV muestra bien los acentos.
- [x] Inicio, Problemas y Métricas contra un tenant real, con exportación y capturas.
- [x] El zip 0.6.0 sobre sus datos aplica la migración 0002 (consultas guardadas) sin perder nada.

### Mejoras para después de la primera versión

- `e2e/views.spec.ts` depende del orden de sus tests: cada test debería preparar su propio estado (anotado en la cabecera del spec).
- Las vistas usan solo el token clásico; usar OAuth y el platform token en SaaS (ver la spec, "Funcionalidades").
- Streaming de exportaciones y aviso de filas de Excel en CSV, con DQL en la Fase 8 (ver la spec, "Exportación de datos").

## Primer paso al retomar

1. `npm install`, y después `npm run check` y `npm run test:e2e`. Si algo falla, arreglarlo antes de seguir.

## Reglas de trabajo

- Una fase cada vez; al terminarla, se continúa con la siguiente y la aceptación manual queda en la lista de pendientes de Dani.
- Las dudas de diseño, alcance dentro de una fase, orden o interpretación de la spec las deciden los agentes, y se anotan en la spec o en el CHANGELOG. Solo se escala a Dani lo destructivo o irreversible (lo aprueba él en la sesión que lo ejecuta), publicar algo nuevo hacia fuera, licencia, marca y temas legales, qué hacen las funciones sin definir, la API cuando no se puede deducir y retomar Monaco. Al cerrar cada fase, un solo resumen para Dani, sin esperar su respuesta: lo hecho, las decisiones tomadas y lo que tiene que probar a mano.
- Mientras Dani no está, peticiones decide en su nombre. Luz verde sin preguntar: lo recuperable con git que ya esté commiteado (código, dependencias exactas, node_modules, out, dist, tests, empaquetar, commits, push normal con el OK de senior y de test), lecturas del tenant de pruebas y matar procesos del equipo.
- Se pregunta a peticiones: borrar o mover lo que no está en git (docs/especificacion.md, %APPDATA%igia, .env.live.local, ..API, nada fuera de app/), escrituras en el tenant, cambios globales en la máquina, y `git reset --hard`, `checkout --`, `clean` o `stash drop` con cambios sin commitear (salvo commit o stash previo). Antes de cada tanda grande de cambios en la spec, copia como docs/.respaldo/especificacion.AAAAMMDD-HHmm.md (carpeta ignorada), conservando las 5 últimas; borrar las más antiguas de esa carpeta está autorizado, y nada más.
- Carpeta de datos por modo: el zip usa %APPDATA%igia, `npm run dev` usa vigia-dev y cada e2e su carpeta temporal (VIGIA_USER_DATA_DIR, solo sin empaquetar). Es normal que en dev no aparezcan los datos del zip.
- Solo lo decide Dani: force push, reescribir el historial publicado, borrar ramas remotas, tags, releases, publicar el zip, licencia y temas legales, y el qué de las funciones sin definir. El zip nunca se arranca en su perfil.
- La API de cada módulo (v1, v2 o plataforma) se deduce de `..\API\` y de la documentación oficial; solo si no se puede deducir, se pregunta a Dani. La elección se anota.
- El repositorio es público. Push automático: solo `git push origin main`, y solo después del visto bueno de senior y de test. Nunca `--force` ni `--force-with-lease`. Sin tags, releases ni subir el zip a GitHub (se escala a Dani). Antes de cada push, `npm run scan:tenant` (busca restos del tenant de pruebas sin mostrar sus valores) y revisar el contenido sensible: autor y committer noreply, sin `docs/especificacion.md`, sin nombres de clientes, secretos, URLs o IDs de tenants reales, logs ni `.env`.
- Un criterio de aceptación manual no se da por cumplido; solo lo confirma Dani.
- No inventar endpoints ni parámetros de Dynatrace o de Monaco: consultar `..\API\` y la documentación oficial.
- Nunca escribir secretos, cabeceras `Authorization` ni cookies en logs, ficheros de configuración, mensajes de error ni en el repositorio.
- Sin definición cerrada no se implementan: Service flows avanzados, Vista de negocio, notificaciones, Favoritos y variación de los KPI.
- Commits pequeños por funcionalidad, con tests para la lógica de main.
- Dependencias con versión exacta: `npm install --save-exact <paquete>`.
- Comentarios, textos de interfaz y documentación en español; identificadores en inglés.
- Al cerrar una fase: subir la versión menor en `package.json` y `CHANGELOG.md` (Fase N → 0.N.0), y actualizar "Estado actual" de este fichero y, si cambia algo de lo acordado, `docs/especificacion.md`. Tags, releases y subir el zip a GitHub se escalan a Dani.

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
- better-sqlite3 13 trae binarios precompilados N-API dentro del paquete: no hace falta recompilar ni `electron-builder install-app-deps`, y funciona igual en Vitest y en Electron. En el zip va fuera del asar (`asarUnpack`) y solo con el binario win32-x64.
- Tras cambiar `src/main/db/schema.ts`: `npm run db:generate` y commitear la migración nueva. Main aplica las migraciones al arrancar (en la app empaquetada, desde `resources/migrations`).
- `lower()` de SQLite solo pasa a minúsculas ASCII: los nombres únicos se comprueban en JS con `toLocaleLowerCase('es')`.
- Cada e2e usa su propia carpeta de datos (`VIGIA_USER_DATA_DIR`): el bloqueo de instancia única va por carpeta, así que no chocan con un `npm run dev` abierto.
- `Set-Content -Encoding utf8` de PowerShell 5.1 escribe BOM, y `Get-Content -Raw` sin `-Encoding utf8` lee los ficheros como ANSI y estropea las tildes al reescribirlos. Para editar ficheros, usar las herramientas de edición, `sed` o `node`.
- Electron cachea el resultado de `setCertificateVerifyProc` y no hay forma de borrarlo: desde la PR #26517 (2020) volver a llamarlo ya no limpia la caché, y el issue #41448 (pedir esa API) sigue abierto. Por eso cada cambio de nivel o de huellas de un entorno crea una partición nueva en memoria `env-<id>-<generación>` (`src/main/dynatrace/network.ts`). Fuentes: https://www.electronjs.org/docs/latest/api/session, https://github.com/electron/electron/pull/26517 y https://github.com/electron/electron/issues/41448.
- El verificador de certificados solo ve el nombre del host, sin puerto; las huellas se guardan con `URL.host` (con puerto) y se comparan por nombre.
- Electron 44 cambió el portapapeles al estilo W3C: `clipboard` de main solo tiene `clear`, `has`, `read`, `readText`, `write` y `writeText` (asíncronos). Ya no hay `readImage` ni `writeImage`: una imagen se copia con `clipboard.write([new ClipboardItem({ "image/png": blob })])`.
- Las vistas de datos no se refrescan solas (`staleTime: Infinity`, `refetchOnMount: false`): cada petición gasta cuota de la API. Solo "Actualizar" o una clave nueva (entorno, filtros, rango) piden datos.
- Cambios hechos por IPC directo (`window.vigia.invoke`) no actualizan la interfaz: TanStack Query solo se entera de las mutaciones que hace el renderer. En los e2e, recargar tras preparar datos por IPC.
- En producción no hay menú (`Menu.setApplicationMenu(null)`), así que tampoco hay atajos de recarga ni DevTools.
- Las librerías solo del renderer van en devDependencies: Vite las empaqueta y electron-builder metería en el asar todo lo de dependencies.
- Si `npm run dist:win` falla en Windows con un error de enlaces simbólicos, hace falta el Modo de desarrollador de Windows o una terminal de administrador.

## Versiones fijadas

Electron 44.5.1, electron-vite 5.0.0, Vite 7.3.6, React 19.3.0, TypeScript 5.9.3, Zod 4.6.5, electron-log 5.4.4, Vitest 5.0.3, Playwright 1.63.0, electron-builder 26.15.3, ESLint 9.39.5, React Router 8.4.0, Zustand 5.0.15, i18next 26.4.2, react-i18next 17.0.15, Tailwind CSS 4.3.3, Motion 14.0.0, cmdk 1.1.1, lucide-react 1.51.0, better-sqlite3 13.0.3, Drizzle ORM 0.45.3, drizzle-kit 0.31.11, TanStack Query 5.104.1, react-hook-form 7.89.0, selfsigned 5.5.0 (solo tests), ExcelJS 4.4.0 (main), ECharts 6.1.0. Node 22 o superior.

Pendiente al subir electron-builder: `npm audit` marca 8 "high" (http-cache-semantics vía `@electron/get`), solo de empaquetado; `npm audit --omit=dev` = 0. No forzar overrides.
