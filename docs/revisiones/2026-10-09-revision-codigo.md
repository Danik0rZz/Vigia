# Revisión de código: 2026-10-09

Revisión automática y periódica del código de Vigía (v0.10.2, `main` en `e32e162`). Es un documento
para el Planificador y los agentes: cada hallazgo lleva lo necesario para convertirlo en una ficha
de `tasks/` y acometerlo con garantías. **No se ha modificado código**; solo se ha escrito este
fichero. Nada se empieza sin ficha aprobada por Dani (ADR-0007).

## Cómo se ha hecho

- Lectura directa de la capa de seguridad y de red de main (`preload`, `ipc/handler.ts`,
  `security/*`, `protocol.ts`, `index.ts`, `window.ts`, `dynatrace/*`, `secrets/store.ts`,
  `local-data.ts`, `ipc/handlers/*`, `shared/ipc.ts`, `shared/tenants.ts`,
  `tenants/repository.ts`).
- Tres revisiones en paralelo, cada una con su informe: módulos de main, exportación, datos locales
  y `shared/`; el renderer entero; y tooling, CI, hooks, e2e y empaquetado.
- Cada hallazgo que aparece aquí se ha contrastado después leyendo las líneas citadas. Lo que no se
  pudo confirmar se dice. Las líneas corresponden al commit indicado arriba.
- Aquí no hay ningún dato del tenant de pruebas ni de clientes.

## Resumen

No hay ningún fallo de seguridad grave. La frontera renderer/main, el preload, la CSP, el protocolo
`app://`, los fusibles de Electron, el cifrado de secretos y el enmascarado de tokens están bien
hechos (ver "Lo que está bien"). Lo que se propone es, sobre todo:

1. **Cerrar tres huecos de "defensa en profundidad"** en main y en la cadena de publicación: el
   escaneo del tenant que pasa en verde cuando no puede escanear, el cliente HTTP que sigue
   redirecciones con el token puesto, y un log sin red de seguridad para secretos.
2. **Corregir comportamientos observables** que hoy están mal o son frágiles: fechas del XLSX en UTC
   junto a una fila que dice la zona local, un `Math.max` que puede reventar la pila con tablas
   grandes, el «Reintentar» de un panel que relanza todas las consultas de la app (contra ADR-0004),
   y un esquema de problemas que exige campos que no se usan.
3. **Reducir duplicación** donde ya ha empezado a divergir: handlers y módulos de métricas, páginas
   de entidad, y un `memo` que no memoiza porque el React Compiler no está instalado aunque el
   código y las reglas de la carpeta hablen de él.
4. **Endurecer CI y hooks**: acciones fijadas por etiqueta, sin `npm audit`, sin artefactos de un
   e2e fallido, y un `pre-commit` que no pasa `typecheck` a los specs e2e.

Impacto: **alto** = afecta a datos, seguridad o cuota del cliente en uso normal; **medio** = fallo
real pero acotado, o deuda que ya cuesta en cada ficha; **bajo** = pulido, coherencia o robustez
ante cambios futuros. Esfuerzo: **pequeño** = una sesión, sin canal IPC nuevo; **medio** = varios
ficheros con tests; **grande** = reestructuración o decisión de Dani.

| Id   | Título                                                                  | Impacto    | Esfuerzo | Zona           |
| ---- | ----------------------------------------------------------------------- | ---------- | -------- | -------------- |
| S-01 | `scan:tenant` pasa en verde si no encuentra `.env.live.local`           | alto       | pequeño  | hooks/scripts  |
| S-02 | El cliente HTTP sigue redirecciones con la cabecera de autenticación    | medio      | pequeño  | main/dynatrace |
| S-03 | El log no tiene filtro global de secretos                               | medio      | pequeño  | main/logging   |
| S-04 | Acciones de GitHub fijadas por etiqueta mutable                         | medio      | pequeño  | CI             |
| S-05 | Sin `npm audit` ni aviso de dependencias en CI                          | medio      | pequeño  | CI             |
| S-06 | Fusible de integridad del asar sin activar                              | medio      | pequeño  | empaquetado    |
| S-07 | Sin límite de concurrencia hacia Dynatrace en main                      | bajo       | pequeño  | main/dynatrace |
| C-01 | Fechas del XLSX en UTC junto a una fila «Zona horaria» local            | medio      | pequeño  | main/export    |
| C-02 | `Math.max(...)` con 100 001 argumentos en el TXT alineado               | medio      | pequeño  | main/export    |
| C-03 | «Reintentar» de un panel relanza todas las consultas activas            | medio      | pequeño  | renderer       |
| C-04 | `problemSchema` exige campos que no se usan y tumba el detalle          | medio      | pequeño  | main/modules   |
| C-05 | Si el renderer cae, la ventana queda en blanco sin salida               | medio      | pequeño  | main           |
| C-06 | Sin copia de seguridad de la base antes de migrar                       | medio      | pequeño  | main/db        |
| C-07 | Los motivos de un entorno no importado se pierden                       | bajo-medio | pequeño  | main/tenants   |
| C-08 | `SecretRow` deja su marca «sucia» al desmontarse                        | bajo       | pequeño  | renderer       |
| C-09 | El valor de un secreto queda minutos en la `MutationCache`              | bajo       | pequeño  | renderer       |
| C-10 | `main.tsx` espera a `app:getInfo` sin tiempo máximo                     | bajo       | pequeño  | renderer       |
| C-11 | Fecha del fichero de configuración en UTC                               | bajo       | pequeño  | main/tenants   |
| C-12 | `savedQueries:delete` no va acotado al entorno                          | bajo       | pequeño  | main/shared    |
| C-13 | `requestAnimationFrame` sin cancelar al desmontar el grid               | bajo       | pequeño  | renderer       |
| C-14 | Los títulos del Markdown del tenant entran en la jerarquía de la página | bajo       | pequeño  | renderer       |
| C-15 | `text()` del selector de problemas se recorta antes de escapar          | bajo       | pequeño  | main/modules   |
| M-01 | Handlers y módulos de métricas repiten el mismo código seis veces       | medio      | medio    | main           |
| M-02 | Las páginas de entidad repiten acceso, marcadores y tablas              | medio      | medio    | renderer       |
| M-03 | `memo` sin efecto y un React Compiler que no existe                     | medio      | medio    | renderer/build |
| M-04 | `views.spec.ts`: el 81 % de los e2e en un solo fichero                  | medio      | grande   | e2e            |
| M-05 | ESLint sin reglas con tipos (promesas sueltas)                          | bajo-medio | medio    | tooling        |
| M-06 | `pre-commit` no pasa `typecheck` a e2e y valida el disco, no el índice  | bajo-medio | pequeño  | hooks          |
| M-07 | El CI no conserva capturas ni logs de un e2e fallido                    | medio      | pequeño  | CI             |
| M-08 | Casts `as` sobre valores que vienen de disco                            | bajo       | pequeño  | main/tenants   |
| M-09 | Fechas formateadas por libre con `Intl.DateTimeFormat`                  | bajo       | pequeño  | renderer       |
| M-10 | Código y ramas que no pueden ejecutarse en producción                   | bajo       | pequeño  | varias         |
| M-11 | Dos vías de transacción para lo mismo                                   | bajo       | pequeño  | main           |
| M-12 | Esperas fijas en los e2e                                                | bajo       | medio    | e2e            |
| M-13 | Alias repetidos en cinco configuraciones; Vitest sin `@renderer`        | bajo       | pequeño  | tooling        |
| M-14 | Ajustes menores de CI (`cancel-in-progress`, caché de Electron)         | bajo       | pequeño  | CI             |
| M-15 | Pequeños: `engine-strict`, flags de tsconfig, textos en e2e             | bajo       | pequeño  | varias         |

Lotes sugeridos (ADR-0010), por orden: **S-01 + S-04 + S-05 + M-07 + M-14** (cadena de
publicación, todo en `.github/`, `.githooks/` y `scripts/`); **S-02 + S-03 + C-05 + C-06 + S-07**
(main, sin canal IPC nuevo); **C-01 + C-02 + C-11** (exportación); **C-03 + C-08 + C-09 + C-10 +
C-13 + C-14** (renderer, fichas ligeras); **C-04 + C-07 + C-12 + C-15 + M-08** (módulos y tenants);
**M-01** y **M-02** por separado; **M-03** necesita decisión de Dani (dependencia nueva o no);
**S-06** ya tiene propuesta (`docs/propuestas-siguientes.md`, 6) y pide una prueba manual del zip.

---

## Lo que está bien (no tocar)

- **Frontera entre procesos.** El preload expone una sola función, valida la entrada con Zod en el
  sandbox y nunca entrega `ipcRenderer`. Main vuelve a validar entrada y salida, rechaza remitentes
  que no sean el frame principal del origen de la app, y a la interfaz solo llegan errores con
  código y `reason`, nunca trazas (`src/main/ipc/handler.ts`).
- **Ventana y sesión.** `contextIsolation`, `sandbox`, sin `nodeIntegration`; navegación y
  ventanas nuevas bloqueadas, `webview` denegado, permisos web denegados; CSP por cabecera sin
  `unsafe-eval` ni orígenes remotos; protocolo `app://` que solo sirve la carpeta del renderer con
  ruta saneada contra `..` y `\0`.
- **Fusibles y empaquetado.** `runAsNode`, `NODE_OPTIONS`, `inspect` y
  `grantFileProtocolExtraPrivileges` cerrados, `onlyLoadAppFromAsar`; `asarUnpack` solo para
  `.node`; todas las dependencias con versión exacta, sin `postinstall`, `publish: null`. Las
  variables `VIGIA_E2E`, `VIGIA_USER_DATA_DIR` y `VIGIA_EXPORT_DIR` se ignoran en la app
  empaquetada.
- **Secretos.** Cifrados con DPAPI, sin respaldo en claro, sin canal IPC de lectura; el renderer solo
  sabe si existen. Las URL de entorno exigen https sin credenciales ni query. `maskSecrets`,
  `redactQueryEcho` y `cleanReason` enmascaran lo que viene de Dynatrace o del SSO antes de que
  llegue a un log o a la interfaz; `entity-secrets.ts` quita líneas de comandos y rutas de las
  propiedades de entidad. El SSO nunca se acepta con nivel «ignorar».
- **Selectores sin inyección.** Todo `entityId(...)`, `filter(...)` y `affectedEntities(...)` se
  construye con ids validados por regex estricta en el contrato; el único texto libre se escapa como
  manda la OpenAPI; los ids de ruta van con `encodeURIComponent` y la query con `URLSearchParams`.
- **Cliente de Dynatrace.** Plazo por intento que cubre cabeceras y cuerpo, reintento acotado de 429
  con `Retry-After`, una sola renovación OAuth por 401, `maxPages` en toda paginación con
  `truncated` y aviso, validación elemento a elemento con contador `invalid`, y partición de red
  por entorno y generación (ADR-0003).
- **Exportación.** Neutralización de fórmulas CSV, BOM y CRLF, nombres de fichero saneados
  (caracteres, controles, nombres reservados de Windows), PNG validado por firma y tamaño,
  `capture:region` acotado a la ventana.
- **Renderer.** Sin `dangerouslySetInnerHTML`, `eval` ni `javascript:`; `MarkdownText` solo con
  enlaces http/https y sin imágenes (ADR-0008); tooltips de ECharts escapados; secretos solo en el
  `useState` de su fila; ADR-0004 aplicado en `data/modules.ts`; cola de peticiones con
  cancelación; ECharts sin fugas; accesibilidad cuidada (roving tabindex, `aria-sort`,
  `role="alert"`, color nunca como única señal).
- **Tooling.** CI con `permissions: contents: read`, `concurrency`, `timeout`, sin secretos y con la
  misma instalación que el README; `forbidOnly` y `retries: 0` en Playwright; un `afterEach` en los
  e2e que comprueba que no hay secretos en IPC ni en el HTML ni peticiones remotas del renderer;
  tests de guardia en `scripts/` que convierten lecciones de fichas en comprobaciones de `check`.
- **Código limpio.** Ni un `console.*`, `any`, `TODO` ni `FIXME` fuera de los tests; cuatro
  `eslint-disable`, todos con motivo.

---

## S. Seguridad y defensa en profundidad

### S-01. `scan:tenant` pasa en verde si no encuentra `.env.live.local`

**Descripción.** `scripts/scan-tenant.mjs:66-68` busca el fichero de credenciales solo en el
directorio desde el que se ejecuta; si no existe, `main` (`:121-124`) escribe «sin
.env.live.local: no hay nada que buscar» y devuelve 0, y el `pre-push` (`.githooks/pre-push:8`)
lo toma por verde. Hoy hay cuatro worktrees (`git worktree list`): el checkout principal y los de
Orca. El flujo dice que el push se hace con `git -C <principal>`, pero nada lo impide desde otro
worktree, donde el fichero no está. `scripts/notify-telegram.mjs:162-174` sí tiene la alternativa
`mainCheckout()` (primer worktree de la lista); `scan-tenant` no. Además el hook escanea siempre
`origin/main..HEAD` (`scan-tenant.mjs:14`) en vez de los refs que git le pasa por stdin.

**Impacto: alto.** Es el único control automático de una regla "que no se salta" del `CLAUDE.md`
(nada del tenant en un repositorio público) y falla abierto: cuando no puede comprobar, aprueba.

**Esfuerzo: pequeño.**

**Ficheros.** `scripts/scan-tenant.mjs`, `scripts/scan-tenant.test.ts`, `.githooks/pre-push`,
`scripts/notify-telegram.mjs` (para compartir `mainCheckout`).

**Relaciones.** Hook `pre-push`; aviso por Telegram (comparte `extractNeedles`); `docs/flujo.md`
(git y push); `CLAUDE.md` (comando `scan:tenant`).

**Solución propuesta.**

1. Extraer a `scripts/lib/env-file.mjs` (o similar) una función `findLiveEnv(cwd)` que pruebe el
   `cwd` y, si no está, el checkout principal (`git worktree list --porcelain`, primera entrada),
   y usarla desde `scan-tenant.mjs` y `notify-telegram.mjs`.
2. En `scan-tenant.mjs`, que «sin .env» sea **fallo** (código 2 con mensaje claro) salvo que se
   declare `VIGIA_SCAN_TENANT_OPTIONAL=1`, pensado para clones ajenos sin tenant de pruebas. En la
   VPS el fichero siempre existe. Documentar la variable en el README y en `docs/flujo.md`.
3. Leer de stdin los pares `local_sha remote_sha` que git pasa al `pre-push` y escanear
   `remote_sha..local_sha`; si la rama remota no existe (`remote_sha` a ceros), caer a
   `origin/main..HEAD`.
4. Tests en `scan-tenant.test.ts`: sin fichero y sin variable → 2; sin fichero y con variable → 0
   con aviso; con fichero en el checkout principal y `cwd` en otro worktree → lo encuentra.

**Explicación.** Un control de seguridad debe fallar cerrado: si no puede comprobar, se para y lo
dice. Un 0 con una línea de aviso se pierde entre la salida de git, y el día que importa nadie la
lee. La diferencia entre "no he encontrado nada" y "no he podido buscar" tiene que ser visible en
el código de salida, no en el texto.

### S-02. El cliente HTTP sigue redirecciones con la cabecera de autenticación

**Descripción.** `src/main/dynatrace/client.ts:231` llama a `deps.fetchFor(envId)(url, { ...init,
signal })` y `src/main/dynatrace/oauth.ts:148` a `deps.fetch(credentials.ssoUrl, {...})` sin fijar
`redirect`; el valor por defecto es `follow`. No hay ninguna mención a `redirect` en `src/main`.
Si la API o un proxy intermedio responde 3xx, Chromium reenvía la petición al destino que indique
`Location`. Chromium quita `Authorization` cuando cambia el origen, pero la decisión de a dónde va
una petición con un `Api-Token` o un `Bearer` no debería depender de la respuesta del servidor; y
en el caso del SSO, un 307 reenviaría el cuerpo con el `client_secret`.

**Impacto: medio.** Ninguna función de Vigía necesita seguir redirecciones (las URL son las del
entorno y la del SSO, sin ruta variable). El riesgo es bajo en la práctica, pero cerrarlo cuesta una
línea y lo convierte en un error explícito.

**Esfuerzo: pequeño.**

**Ficheros.** `src/main/dynatrace/client.ts` (`send`), `src/main/dynatrace/oauth.ts`
(`requestToken`), `client.test.ts`, `oauth.test.ts`, `src/test/live-client.ts` (ya usa
`redirect: 'error'` en `createReadOnlyFetch`: es el precedente).

**Relaciones.** Todos los canales que llaman a Dynatrace; «Probar conexión»; `docs/notas-api-v2.md`
si en vivo se observa alguna redirección legítima (no se conoce ninguna).

**Solución propuesta.** Pasar `redirect: 'error'` en los dos `fetch`. Con `error`, una 3xx
rechaza la promesa con un `TypeError`; en `send()` se convierte en `DtError('NETWORK', …)` con un
`reason` nuevo `redirectRefused` (clave en `src/shared/error-reasons.ts` y textos es/en) para que el
usuario entienda que la URL del entorno no es la final. Test: un `fetch` simulado que rechace con
el error de redirección produce ese `DtError`; un test que compruebe que `init.redirect === 'error'`
en la llamada. Antes de cerrar, una pasada de `npm run test:live` confirma que ninguna llamada real
pasa por 3xx.

**Explicación.** Una credencial debe viajar solo al host que el usuario configuró. `follow` delega
en el servidor (o en quien se ponga en medio) a dónde se reenvía la petición. Hacerlo explícito
cuesta nada y, si algún día hay una redirección legítima, el error dirá exactamente qué pasa en vez
de funcionar por accidente.

### S-03. El log no tiene filtro global de secretos

**Descripción.** `src/main/logging.ts` configura electron-log (fichero rotado, nivel, captura de
excepciones no controladas con `errorHandler.startCatching`) y la regla «nunca secretos en el log»
se cumple llamada a llamada: `maskSecrets` en `DtError`, `redactQueryEcho` en el cliente,
`maskErrorDetails` en `app:logRendererError`. No hay ningún `log.hooks` (`grep` vacío en
`src/main`). Las excepciones no controladas que atrapa `startCatching` se escriben con su mensaje
y su pila tal cual; si una librería (o un error futuro de Vigía) incluyera un token en un mensaje,
iría al fichero sin pasar por ningún filtro.

**Impacto: medio.** Hoy no hay ninguna fuga conocida; es una red de seguridad para la regla más
repetida del proyecto, que se aplica a mano en cada sitio.

**Esfuerzo: pequeño.**

**Ficheros.** `src/main/logging.ts`, nuevo `src/main/log-mask.ts` (puro, con test), `src/shared/mask.ts`.

**Relaciones.** Todo lo que escribe en `log`; `src/main/ipc/handlers/app.ts` (sigue enmascarando
antes, el hook es la segunda capa); `docs/ARCHITECTURE.md` (principios).

**Solución propuesta.** Una función pura `maskLogMessage(message)` que recorra `message.data`:
cadenas → `maskSecrets`; `Error` → nuevo objeto con `message` y `stack` enmascarados (sin perder
`name` y `cause`); objetos planos → `JSON` enmascarado o recorrido superficial de sus valores de
texto. Registrarla con `log.hooks.push((message) => maskLogMessage(message))` en `initLogging`.
Tests en `log-mask.test.ts`: un `Api-Token …` dentro de un `Error` sale como `Api-Token ***`; un
token `dt0c01.<pública>.<secreta>` conserva la parte pública; un objeto con un valor que no es
texto no cambia. Documentar en `src/main/CLAUDE.md` que el hook es la última barrera, no un permiso
para registrar secretos.

**Explicación.** Las reglas que dependen de que cada autor se acuerde fallan el día que alguien no
se acuerda, o cuando el texto lo genera una librería ajena. Un filtro en el único punto por el que
pasa todo el log convierte la regla en una propiedad del sistema. El coste es un recorrido por
mensaje, despreciable para el volumen de log de Vigía.

### S-04. Acciones de GitHub fijadas por etiqueta mutable

**Descripción.** `.github/workflows/ci.yml:28` y `:32` usan `actions/checkout@v7` y
`actions/setup-node@v7`. Una etiqueta `vN` la puede mover el dueño del repositorio de la acción, o
quien le robe la cuenta (incidente de `tj-actions/changed-files`, 2025). Además
`scripts/ci-workflow.test.ts:11-14` exige que la versión sea literalmente `v7`, así que fijar un
SHA haría fallar `npm run check`.

**Impacto: medio.** Está mitigado: el workflow tiene `permissions: contents: read`, no hay secretos
ni `pull_request_target`, y el zip no se publica desde CI. Una acción comprometida podría dar un
falso verde, no escribir en el repositorio. Aun así es la práctica estándar de la guía de
endurecimiento de GitHub.

**Esfuerzo: pequeño.**

**Ficheros.** `.github/workflows/ci.yml`, `scripts/ci-workflow.test.ts`.

**Relaciones.** CI; `check` (el test de scripts); S-05 si se adopta Dependabot (es quien propondría
las subidas de SHA).

**Solución propuesta.** `uses: actions/checkout@<sha de 40 hex> # v7.x.y` y lo mismo para
`setup-node`. En `ci-workflow.test.ts`, exigir un SHA de 40 hexadecimales y leer la mayor del
comentario `# vX.Y.Z` para seguir comprobando que es la esperada. Documentar en el test cómo se
obtiene el SHA (`git ls-remote https://github.com/actions/checkout refs/tags/v7.x.y`).

**Explicación.** Un SHA identifica un contenido exacto; una etiqueta es un puntero que puede moverse
sin que nadie del proyecto lo sepa. Con el SHA, lo que corre en CI es lo que se revisó al fijarlo.

### S-05. Sin `npm audit` ni aviso de dependencias en CI

**Descripción.** `ci.yml:37-41` no ejecuta `npm audit` y no hay `.github/dependabot.yml`. El estado
de vulnerabilidades es una foto manual en `docs/ARCHITECTURE.md` (2026-10-04) que envejece con cada
ficha. Las dependencias de producción son cinco, pero ExcelJS arrastra un `uuid` vulnerable
(documentado como no alcanzable) y nadie se entera si aparece algo que sí lo sea.

**Impacto: medio.** Las vulnerabilidades se publican después de instalar; sin comprobación
continua, el dato de `ARCHITECTURE.md` es cierto solo el día que se escribió.

**Esfuerzo: pequeño.**

**Ficheros.** `.github/workflows/ci.yml` (o un workflow nuevo `audit.yml`), `docs/ARCHITECTURE.md`.

**Relaciones.** CI; flujo con agentes (si Dependabot abre PRs, el flujo hoy no contempla PRs: es una
decisión de Dani); S-04.

**Solución propuesta.** Un paso en CI `npm audit --omit=dev --audit-level=high` (bloqueante: lo que
llega al zip) y otro `npm audit --audit-level=critical` para desarrollo con `continue-on-error:
true` al principio, hasta ver el ruido. Si Dani no quiere PRs automáticos, un workflow con
`schedule` semanal y `workflow_dispatch` que solo audite y se vea en rojo en la pestaña Actions.
Actualizar la nota de `ARCHITECTURE.md` para decir que la foto la mantiene el CI.

**Explicación.** Separar producción de desarrollo evita que el ruido de herramientas (esbuild,
electron-get) tape lo único que importa para el usuario: lo que va dentro del zip.

### S-06. Fusible de integridad del asar sin activar

**Descripción.** `electron-builder.yml:39-44` configura cinco fusibles pero no
`enableEmbeddedAsarIntegrityValidation`. Sin él, `onlyLoadAppFromAsar: true` obliga a cargar desde
`app.asar`, pero no comprueba que el asar sea el original: cualquiera puede sustituir
`resources/app.asar` dentro del zip y el ejecutable lo carga igual. Ya está identificado en
`docs/propuestas-siguientes.md` (propuesta 6), sin ficha. No hay firma de código.

**Impacto: medio.** Vigía guarda tokens cifrados con `safeStorage`; un asar sustituido corre con el
contexto del usuario y los lee. La firma de código (certificado de pago, lo decide Dani) es además
lo único que evita el aviso de SmartScreen.

**Esfuerzo: pequeño** el fusible; **grande** la firma (decisión y coste).

**Ficheros.** `electron-builder.yml`, `docs/pendiente-dani.md` (prueba manual del zip),
`docs/ARCHITECTURE.md` (anotar la falta de firma como riesgo conocido).

**Relaciones.** Empaquetado (`dist:win`); ADR-0006 (los e2e corren sobre `out/`, no prueban el
zip); propuesta 6.

**Solución propuesta.** Convertir la propuesta 6 en ficha: añadir
`enableEmbeddedAsarIntegrityValidation: true`, generar el zip y arrancarlo en un perfil de prueba
(nunca el de Dani), comprobando que `better-sqlite3` (fuera del asar por `asarUnpack`) sigue
cargando. Escalar a Dani la firma de código como decisión aparte.

**Explicación.** Los fusibles cierran puertas del binario de Electron. `onlyLoadAppFromAsar` cierra
la de cargar código suelto; la integridad cierra la de cambiar el asar mismo. Sin la segunda, la
primera vale poco contra quien tenga acceso a la carpeta de la app.

### S-07. Sin límite de concurrencia hacia Dynatrace en main

**Descripción.** El renderer frena las peticiones con `src/renderer/src/lib/request-queue.ts`, pero
main no tiene ningún límite propio: `createDtClient` (`src/main/dynatrace/client.ts`) atiende
cuantas lleguen. El propio código declara el principio contrario para los errores
(`src/main/ipc/handlers/app.ts:33`: «el renderer ya frena, pero main no se fía: el suyo propio»).
Una página de host lanza en paralelo cinco canales con hasta nueve peticiones; con un «Reintentar»
mal acotado (C-03) o un renderer en bucle, el límite real lo pone Dynatrace con 429.

**Impacto: bajo.** Hoy el renderer lo tapa y el 429 se reintenta con `Retry-After`.

**Esfuerzo: pequeño.**

**Ficheros.** `src/main/dynatrace/client.ts`, `client.test.ts`.

**Relaciones.** Todos los canales de datos; el reintento de 429 (que ya existe).

**Solución propuesta.** Un semáforo por entorno dentro de `createDtClient` (por ejemplo, 6 en vuelo,
cola FIFO) alrededor de `send`, inyectable para tests. Test: con 10 peticiones simultáneas y un
`fetch` que no resuelve, solo 6 llegan a `fetchFor`; al resolver una, entra la séptima. Registrar en
el log (nivel `debug`) cuando la cola supere, por ejemplo, 20 pendientes.

**Explicación.** La defensa en profundidad es que cada capa se proteja sola. El renderer puede
cambiar (o fallar) y main es quien paga la cuota del cliente.

---

## C. Correcciones

### C-01. Fechas del XLSX en UTC junto a una fila «Zona horaria» local

**Descripción.** `src/main/export/xlsx.ts:60` (`cellValue`: `toDate(value)`), `:89` (`numFmt:
'yyyy-mm-dd hh:mm:ss'`) y `:155-164` (filas `exported`, `from`, `to` de la hoja Info) escriben
objetos `Date` con ExcelJS. ExcelJS convierte un `Date` a serial de Excel con `getTime()`, es
decir, en UTC, y el formato lo pinta tal cual: Excel enseña la hora UTC. Justo debajo, la hoja Info
añade `[labels.timeZone, info.timeZone]` (`:160`) con la zona local del equipo
(`local-data.ts:139`: `Intl.DateTimeFormat().resolvedOptions().timeZone`). El lector ve «Zona
horaria: Europe/…» y unas horas desplazadas una o dos horas. CSV y TXT no tienen el problema:
escriben ISO con la `Z` (`format.ts:17`). El test `xlsx.test.ts:123-152` no lo detecta porque hace
ida y vuelta por ExcelJS.

**Impacto: medio.** Es lo que un cliente abre en Excel; los datos son correctos pero la fila de
zona horaria afirma algo falso sobre ellos.

**Esfuerzo: pequeño.**

**Ficheros.** `src/main/export/xlsx.ts`, `src/main/ipc/handlers/export.ts` (`infoOf`),
`src/main/export/xlsx.test.ts`, `docs/pendiente-dani.md`.

**Relaciones.** Canales `export:table` y `export:workbook` con formato `xlsx`; etiqueta `timeZone`
de `xlsxLabelsSchema` y sus textos en `locales/`.

**Solución propuesta.** Elegir una de dos y aplicarla por igual a las celdas de datos y a la hoja
Info:

- (a) Hora de pared local: `toExcelLocal(d) = new Date(Date.UTC(d.getFullYear(), d.getMonth(),
d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()))` en `cellValue` y en las filas de
  Info, de modo que Excel enseñe la hora de la zona que dice la fila. Es lo que espera quien abre el
  fichero.
- (b) Dejar UTC y cambiar la fila a «Zona horaria de las fechas: UTC», moviendo la zona local a
  otra fila si se quiere.

Test: en `xlsx.test.ts`, un `describe` con `process.env.TZ` fijado (Vitest ya fija `TZ`), exportar
un instante conocido, leer el serial de la celda y comprobar la hora que Excel mostraría. Queda una
prueba manual para Dani (abrir el fichero en Excel): anotarla en `docs/pendiente-dani.md`.

**Explicación.** Excel no guarda zonas horarias: un serial es un número de días. Toda librería tiene
que decidir si ese número es UTC o local, y ExcelJS decide UTC. Si la exportación lleva una fila que
dice la zona, las celdas tienen que estar en esa zona; si no, la fila convierte un dato ambiguo en
uno falso.

### C-02. `Math.max(...)` con 100 001 argumentos en el TXT alineado

**Descripción.** `src/main/export/txt.ts:10-12`:

```ts
const widths = columns.map((_column, index) =>
  Math.max(...[header, ...body].map((line) => [...(line[index] ?? '')].length))
)
```

Se esparce un array de `rows.length + 1` elementos como argumentos. `MAX_EXPORT_ROWS` es 100 000
(`src/shared/modules.ts:582`): 100 001 argumentos. Medido con Node 22 en esta máquina, 120 000
funciona y 125 000 lanza `RangeError: Maximum call stack size exceeded`; el margen es del 20 % y
depende del tamaño de pila y de la profundidad en el momento de la llamada (dentro de un handler
IPC, en Electron). Si falla, el usuario recibe un `INTERNAL` sin `reason`.

**Impacto: medio.** Solo con tablas enormes y solo en TXT alineado, pero el fallo sería opaco y el
margen es pequeño.

**Esfuerzo: pequeño.**

**Ficheros.** `src/main/export/txt.ts`, `src/main/export/export.test.ts`.

**Relaciones.** `export:table` y `export:workbook` con formato `txt`.

**Solución propuesta.** Calcular el ancho con un bucle (`for (const line of lines) width =
Math.max(width, …)`), sin esparcir. Test: `buildTxt` con `MAX_EXPORT_ROWS` filas y tres columnas no
lanza y produce la cabecera y la regla esperadas.

**Explicación.** `f(...array)` pone cada elemento en la pila como argumento; el límite no está
escrito en ningún sitio y cambia por entorno. Para agregados sobre listas que pueden ser grandes, un
bucle es igual de claro y no tiene techo.

### C-03. «Reintentar» de un panel relanza todas las consultas activas de la app

**Descripción.** `src/renderer/src/components/PanelBoundary.tsx:21-24`:

```ts
private readonly retry = (): void => {
  void queryClient.refetchQueries({ type: 'active' })
  this.setState({ error: null })
}
```

`PanelBoundary` envuelve cada mini gráfico de evidencia (`EvidenceSection.tsx:262-270`), la tabla
de evidencias (`:902`), cada gráfico de entidad (`EntityChartPanel.tsx:157`), el gráfico de
Métricas (`MetricChartPanel.tsx:113`) y la línea de tiempo y la tabla de Problemas
(`ProblemsPage.tsx:304,345`). En el detalle de un problema con quince evidencias con métrica, un
panel que falle y un clic en «Reintentar» disparan `problems:get` más quince `metrics:query`. En una
página de host, `hostMetrics`, `hostBreakdown`, `problemCounts`, `problems` y `entities:get` a la
vez. El error que atrapa un boundary es de render; los datos ya están en caché.

**Impacto: medio.** Gasta cuota del tenant del cliente en contra de ADR-0004 («solo Actualizar o
una clave nueva piden datos»), y se activa justo cuando algo va mal, que es cuando más fácil es
pulsar varias veces.

**Esfuerzo: pequeño.**

**Ficheros.** `components/PanelBoundary.tsx`; `EvidenceSection.tsx`, `EntityChartPanel.tsx`,
`MetricChartPanel.tsx`, `ProblemsPage.tsx`, `app/RouteError.tsx` (mismo patrón, menos grave porque
la página ya está desmontada); `e2e/errors.spec.ts`.

**Relaciones.** Todos los canales de datos por vía indirecta; `useModuleRefresh` de `data/modules.ts`
ya tiene el patrón correcto (`refetchQueries({ queryKey: [envId, module], type: 'active' })`).

**Solución propuesta.** `PanelBoundary` recibe una prop opcional `onRetry`. Por defecto,
«Reintentar» solo hace `setState({ error: null })` y vuelve a pintar con lo que hay en caché. Quien
quiera recargar datos pasa su refetch: en `EntityChartPanel`, `() => void query.refetch()`; en
`MetricChartPanel`, el `refresh` de la página; en `EvidenceSection`, el `refetch` del gráfico de esa
evidencia. Test e2e en `errors.spec.ts`, con el simulador que registra `sim.requests`: abrir un
problema con varias evidencias con métrica, provocar el fallo de un panel y comprobar que al pulsar
`panel-retry` el número de `GET /api/v2/metrics/query` no crece (cero con el comportamiento por
defecto).

**Explicación.** Un error boundary atrapa fallos de pintar, no de datos. Mezclar «volver a pintar»
con «volver a pedir todo» hace que el botón más usado cuando algo falla sea el más caro para el
cliente. Cada panel sabe qué consulta le toca; el boundary genérico no, y por eso no debería
decidirlo.

### C-04. `problemSchema` exige campos que no se usan y tumba el detalle entero

**Descripción.** `src/main/modules/problems.ts:122-142` marca como obligatorios
`impactedEntities`, `managementZones` y `problemFilters: z.array(z.unknown())` (`:135`).
`problemFilters` no se usa en ningún sitio (única aparición en `src/`). `problemDetailSchema`
extiende `problemSchema`, y `problems:get` (`handlers/modules.ts:154-160`) valida con él la
respuesta entera: si Dynatrace dejara de enviar `problemFilters` (o lo enviara como `null`), la
página de detalle fallaría con `INVALID_RESPONSE`, mientras que en la lista `parseItems` solo
descartaría ese elemento. Para el mismo objeto de la API, `entityProblemItemSchema` acepta
`endTime: z.number().nullable()` (`:87`) y `problemSchema` exige `endTime: z.number()` (`:131`).

**Impacto: medio.** Hoy funciona; es fragilidad ante un cambio menor de la API en campos que no se
muestran, y el fallo sería en la vista más usada.

**Esfuerzo: pequeño.**

**Ficheros.** `src/main/modules/problems.ts`, `problems.test.ts`.

**Relaciones.** `problems:list`, `problems:get`, `entities:problems`.

**Solución propuesta.** Quitar `problemFilters`; hacer `impactedEntities`, `managementZones` y las
claves `k8s.*` opcionales con `?? []` en `toProblemSummary`; unificar `endTime` como
`z.number().nullable()` y mapear `null` y `-1` a `null` en los dos `toXxx` (ya lo hace
`toEntityProblem`). Tests: un `Problem` sin `problemFilters` ni `impactedEntities` pasa
`problemSchema` y `problemDetailSchema`; `endTime: null` en el detalle se resuelve como abierto.

**Explicación.** Validar lo que se muestra protege a la interfaz; validar lo que no se muestra solo
añade formas de romperse. El comentario del propio fichero (`:76-77`: «el resto no se valida, para
que un cambio en campos que no se usan no descarte el problema») es el criterio correcto, y
`problemSchema` no lo cumple.

### C-05. Si el renderer cae, la ventana queda en blanco sin salida

**Descripción.** No hay ningún oyente de `render-process-gone`, `child-process-gone` ni
`unresponsive` en `src/main` (`grep` vacío). En producción no hay menú
(`Menu.setApplicationMenu(null)`, `index.ts:62`), así que tampoco hay atajo de recarga. Si el
proceso del renderer muere (memoria, fallo de GPU, un bug de Chromium), la ventana queda en blanco y
la única salida es cerrar la app. `AppErrorBoundary` no ayuda: vive dentro del proceso que ha
caído.

**Impacto: medio.** Es raro, pero cuando ocurre el usuario no tiene información ni salida, y en el
log de main no queda nada.

**Esfuerzo: pequeño.**

**Ficheros.** `src/main/window.ts`, `src/main/index.ts`, nuevo módulo puro con la decisión
(`src/main/crash-policy.ts` o similar) y su test.

**Relaciones.** Ventana principal; logging; `app:logRendererError` (no aplica: el renderer ya no
está).

**Solución propuesta.** En `createMainWindow`, `window.webContents.on('render-process-gone', (_e,
details) => …)`: registrar `details.reason` y `exitCode` en el log y, salvo `reason === 'clean-exit'`
o `'killed'`, recargar con `webContents.reload()` una vez; si vuelve a caer en menos de un minuto,
`dialog.showErrorBox` con un mensaje que remita a los logs y cerrar. `window.on('unresponsive')`:
tras un tiempo, diálogo con «Esperar» y «Cerrar». La política (cuántos reintentos, en qué ventana
de tiempo) en una función pura con test; la capa de Electron solo la llama. Prueba manual para Dani:
en desarrollo, matar el proceso del renderer desde el Administrador de tareas y ver la recarga.

**Explicación.** Electron separa procesos para que una caída del renderer no tumbe main; main tiene
que aprovecharlo y hacer algo. Sin oyente, la separación solo sirve para que la ventana se quede
en blanco en vez de cerrarse.

### C-06. Sin copia de seguridad de la base antes de migrar

**Descripción.** `src/main/db/database.ts:12-19` abre `vigia.db`, activa WAL y claves foráneas y
aplica las migraciones pendientes al arrancar. No hay ninguna copia previa. `src/main/CLAUDE.md`
dice que «una migración nueva es una prueba a mano para Dani (arrancar el zip sobre sus datos)»:
la prueba se hace sobre los datos reales sin red de seguridad. La base contiene clientes, entornos,
huellas de certificado, consultas guardadas y los secretos cifrados.

**Impacto: medio.** Drizzle aplica cada migración en transacción, así que un fallo deja la base
como estaba; el riesgo es una migración que termina «bien» y deja datos mal (por ejemplo, un
`ALTER` que pierde una columna), que solo se ve después.

**Esfuerzo: pequeño.**

**Ficheros.** `src/main/db/database.ts` (o un módulo nuevo `db/backup.ts` puro), `src/main/paths.ts`,
`src/main/local-data.ts`, `database.test.ts`, `docs/ARCHITECTURE.md` (tabla de datos).

**Relaciones.** Arranque de main; `settings` (para guardar la versión con la que se abrió la base
por última vez); carpeta de datos (`%APPDATA%\vigia\backups\`).

**Solución propuesta.** Antes de `migrate`, si el fichero existe y hay migraciones pendientes (leer
`__drizzle_migrations` o comparar el ajuste `schemaVersion` guardado con el número de ficheros de
la carpeta de migraciones), hacer `sqlite.backup(join(backupsDir, `vigia-antes-de-${nombre}.db`))`
(la API de copia de better-sqlite3 es consistente con WAL) y conservar las tres últimas. Registrar
en el log la ruta de la copia. Tests: con una base en fichero temporal y una migración nueva se crea
la copia y la base sigue funcionando; sin migraciones pendientes no se crea nada; con cuatro copias
se borra la más antigua. Documentar en `ARCHITECTURE.md` dónde están y cómo restaurar (cerrar la
app, copiar encima).

**Explicación.** Una migración es la única operación de Vigía que cambia la estructura de los datos
del usuario sin que él lo pida. Hacer copia antes es la práctica mínima que permite deshacer un
error que los tests no vieron; cuesta milisegundos y unos KB.

### C-07. Los motivos de un entorno no importado se pierden

**Descripción.** `src/main/tenants/config-file.ts:103-107` captura `DomainError` y `ZodError` por
entorno y guarda `summary.errors.push({ name, message: describeError(error) })`; `describeError`
compone rutas y mensajes de Zod (en inglés). Ese `message` cruza el IPC (`importSummarySchema`,
`src/shared/tenants.ts:166`) sin `reason`, y el renderer solo pinta el nombre
(`TenantsSection.tsx:106`). Main tampoco lo escribe en el log. El usuario sabe que «Entorno X»
falló, pero nadie sabe por qué, ni en pantalla ni en `main.log`.

**Impacto: bajo-medio.** Solo al importar configuraciones; pero es un error tragado en la práctica.

**Esfuerzo: pequeño.**

**Ficheros.** `src/main/tenants/config-file.ts`, `src/main/ipc/handlers/tenants.ts`,
`src/shared/tenants.ts`, `src/shared/error-reasons.ts`, `src/renderer/src/settings/TenantsSection.tsx`,
`locales/`.

**Relaciones.** Canal `config:import`; `importSummarySchema`; regla «main no traduce» (ADR-0005).

**Solución propuesta.** (1) En `importConfig` registrar con `logger.warn` cada error con nombre y
mensaje (los mensajes de Zod llevan rutas y tipos esperados, no valores; comprobarlo en el test).
(2) Sustituir `message` por un `reason` traducible: para `DomainError` ya existe
(`environmentNameTaken`…); para `ZodError`, una clave `configEnvironmentInvalid` con `params:
{ fields: 'platformUrl, type' }` (rutas, sin valores). La interfaz muestra «Entorno X: campos no
válidos: platformUrl». Tests: `config-file.test.ts` comprueba el `reason`; test del handler
comprueba la línea de log.

**Explicación.** Un error que se captura y no se enseña ni se registra es un error perdido. La regla
del proyecto («main no traduce, lleva `reason`») existe para que un fallo tenga un texto en el
idioma del usuario y un rastro en el log.

### C-08. `SecretRow` deja su marca «sucia» al desmontarse

**Descripción.** `src/renderer/src/settings/SecretsPanel.tsx:46-48`:

```ts
useEffect(() => {
  onDirtyChange?.(kind, dirty)
}, [onDirtyChange, kind, dirty])
```

Sin función de limpieza. `EnvironmentForm` acumula los `kind` sucios en un `Set`
(`EnvironmentForm.tsx:57-69`) y, al cerrar, pregunta si hay alguno (`:70-73`). Caso real: se escribe
algo en «Secreto de cliente OAuth», se cambia el despliegue a Managed y se guarda confirmando el
borrado de plataforma; el entorno llega ya como Managed, `kindsFor` deja de pintar las filas de
plataforma, esas filas se desmontan sin limpiar su marca y `requestClose()` abre «Hay secretos sin
guardar» por un campo que ya no existe.

**Impacto: bajo.** Caso raro; solo molesta.

**Esfuerzo: pequeño.**

**Ficheros.** `settings/SecretsPanel.tsx`; e2e `tenants.spec.ts`.

**Relaciones.** `settings/EnvironmentForm.tsx`.

**Solución propuesta.** `return () => onDirtyChange?.(kind, false)` en ese efecto. Test e2e: escribir
en un secreto de plataforma, pasar a Managed, guardar y confirmar; no debe aparecer el diálogo de
secretos sin guardar.

**Explicación.** Un efecto que informa hacia arriba de un estado debe deshacer esa información
cuando el componente se va; si no, el padre guarda un recuerdo de un hijo que ya no existe.

### C-09. El valor de un secreto queda minutos en la `MutationCache`

**Descripción.** `SecretRow` guarda el token con `useTenantMutation('secrets:set')` y llama a
`save.reset()` en el `finally` (`SecretsPanel.tsx:50-63`) con un comentario que explica la
intención. Pero `reset()` solo desengancha el observer: en TanStack Query v5 la mutación sigue en
la `MutationCache` global con `state.variables` (`{ environmentId, kind, value }`) hasta que vence
su `gcTime` (cinco minutos por defecto; `useTenantMutation` en `data/tenants.ts:176-202` no fija
ninguno). Lo mismo si la mutación falla.

**Impacto: bajo.** Solo memoria del renderer, sin persistencia, sin devtools en producción; pero
contradice la intención escrita en el código.

**Esfuerzo: pequeño.**

**Ficheros.** `settings/SecretsPanel.tsx`, `data/tenants.ts`, `data/tenants.test.ts`.

**Relaciones.** Canal `secrets:set`.

**Solución propuesta.** Que `useTenantMutation` acepte `{ gcTime?: number }` y `SecretRow` pase
`gcTime: 0`: con 0, al hacer `reset()` la mutación se elimina de la caché en el siguiente tick.
Test en `data/tenants.test.ts`: con un `QueryClient` real e `invoke` simulado, tras `mutateAsync`,
`reset()` y un tick, `queryClient.getMutationCache().findAll()` no contiene ninguna mutación con
`variables.value`.

**Explicación.** TanStack Query guarda cada mutación en una caché para poder enseñar su estado aunque
el componente se desmonte. Para datos normales está bien; para una credencial, lo que no se
necesita no debería quedarse, aunque sea en memoria.

### C-10. `main.tsx` espera a `app:getInfo` sin tiempo máximo

**Descripción.** `src/renderer/src/main.tsx:30-46`: el primer `render` solo ocurre cuando `await
invoke('app:getInfo')` resuelve o rechaza. El `try/catch` cubre un rechazo, pero no una promesa que
nunca termina (handler sin registrar por un fallo temprano en main, IPC colgado): la ventana queda
en blanco sin `AppErrorBoundary`, porque aún no hay árbol de React.

**Impacto: bajo.** Hoy main registra los handlers antes de crear la ventana; es robustez ante un
fallo futuro.

**Esfuerzo: pequeño.**

**Ficheros.** `main.tsx`, `lib/error-log.ts`; `Sidebar.tsx:85` (vuelve a pedir `app:getInfo`).

**Relaciones.** Canal `app:getInfo`.

**Solución propuesta.** `Promise.race` con un `setTimeout` de unos dos segundos que resuelva con
valores por defecto (`errorTrigger: false`, versión vacía) y que `setErrorLogVersion` se complete
después si la respuesta llega tarde. De paso, sembrar `queryClient.setQueryData(['appInfo'], info)`
para que `Sidebar` no repita la llamada.

**Explicación.** Todo lo que bloquea el primer render es un punto en el que la app no puede ni
enseñar su propio error. Lo que se espera ahí debe tener un tiempo máximo.

### C-11. Fecha del fichero de configuración en UTC

**Descripción.** `src/main/export/file-name.ts:28` construye `AAAAMMDD-HHmm` en hora local
(documentado). `src/main/ipc/handlers/tenants.ts:73` nombra la configuración con
`date.toISOString().slice(0, 10)`, que es UTC: entre las 00:00 y las 02:00 (hora peninsular) el
fichero lleva la fecha del día anterior.

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** `src/main/ipc/handlers/tenants.ts`, `src/main/export/file-name.ts`, tests.

**Relaciones.** `config:export`.

**Solución propuesta.** Exportar de `file-name.ts` una función `localDateStamp(date)` y usarla en los
dos sitios; test con una fecha a las 00:30 locales.

**Explicación.** `toISOString()` siempre es UTC; para nombres que el usuario relaciona con «hoy»
hay que usar los getters locales, como ya hace `exportFileName`.

### C-12. `savedQueries:delete` no va acotado al entorno

**Descripción.** `src/main/modules/saved-queries.ts:82-84` borra por `id` sin comprobar entorno ni
existencia, y el canal (`src/shared/ipc.ts:441-444`) solo recibe `{ id }`, mientras `list` y
`save` van por `environmentId`. En una base local de un solo usuario no es un agujero, pero el
contrato es asimétrico y, si un día una vista enseña consultas de varios entornos, borrará a
ciegas.

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** `src/main/modules/saved-queries.ts`, `src/shared/ipc.ts`,
`src/main/ipc/handlers/modules.ts:595`, el renderer que invoca el canal, tests.

**Relaciones.** `savedQueries:delete`; `SavedQueriesPanel.tsx`.

**Solución propuesta.** Añadir `environmentId` a la entrada y filtrar por `id` y `environmentId`;
test: borrar con el entorno equivocado no borra nada.

**Explicación.** Las operaciones de un recurso hijo deberían llevar siempre la clave del padre:
cuesta lo mismo hoy y evita un bug de alcance mañana.

### C-13. `requestAnimationFrame` sin cancelar al desmontar el grid

**Descripción.** `src/renderer/src/components/DataGrid.tsx:381-398`: `onScroll` guarda el `frame`
en un ref y lo cancela solo al llegar otro scroll. Si el grid se desmonta justo tras un scroll
(abrir un problema con Enter mientras la lista se mueve), el callback se ejecuta después y puede
llamar a `onFirstVisibleChange` (store de una página ya desmontada).

**Impacto: bajo.** Inocuo en la práctica (es un store de Zustand, no `setState` de React).

**Esfuerzo: pequeño.**

**Ficheros.** `components/DataGrid.tsx`.

**Solución propuesta.** `useEffect(() => () => cancelAnimationFrame(frame.current), [])`.

**Explicación.** Todo lo que se programa (timers, rAF, listeners) se desprograma en la limpieza del
efecto; es el mismo principio que ya cumple el `ResizeObserver` de `Chart.tsx`.

### C-14. Los títulos del Markdown del tenant entran en la jerarquía de la página

**Descripción.** `src/renderer/src/components/MarkdownText.tsx:56-61` pinta los títulos del Markdown
como `<h1>`…`<h6>` reales (con clases pequeñas). La descripción va dentro de una sección con
`role="heading" aria-level={4}` (`EvidenceDescription.tsx:34-41`) y la página tiene su propio
`<h1>`. Un `# Título` escrito por quien configuró el evento aparece en el listado de encabezados del
lector de pantalla al mismo nivel que el título de la página. No es seguridad (es texto); es
accesibilidad.

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** `components/MarkdownText.tsx`, `MarkdownText.test.ts`.

**Relaciones.** ADR-0008; `EvidenceDescription.tsx`.

**Solución propuesta.** Mapear `h1`–`h6` a `<p role="heading" aria-level={Math.min(6, 4 + nivel)}>`
con las clases actuales; test: `# a` → nivel 5, `###### b` → nivel 6.

**Explicación.** El contenido del tenant no debe poder reordenar la estructura de la página; los
encabezados son navegación para quien no ve la pantalla.

### C-15. `text()` del selector de problemas se recorta antes de escapar

**Descripción.** `src/main/modules/problems.ts:53-54` recorta el texto a 30 caracteres y después lo
escapa (`~` → `~~`, `"` → `~"`), lo que puede hasta duplicar la longitud. La OpenAPI dice «The
search value is limited to 30 characters». Si Dynatrace cuenta el valor escapado, un texto con
muchas comillas daría 400 con el texto de Dynatrace. **No se ha podido confirmar en vivo.**

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** `src/main/modules/problems.ts`, `problems.test.ts`, un `*.live.test.ts` de solo
lectura, `docs/notas-api-v2.md`.

**Relaciones.** `problems:list`.

**Solución propuesta.** Comprobar primero en vivo (solo lectura) si `text()` con 30 caracteres que
escapan a 60 devuelve 200 o 400. Si es 400, recortar sobre el valor escapado y anotarlo en
`notas-api-v2.md`; si es 200, anotarlo también y cerrar sin cambios.

**Explicación.** Cuando una API pone un límite sobre un valor que además se escapa, hay que saber
sobre cuál de las dos formas cuenta. Hasta verificarlo, lo honesto es dejarlo anotado.

---

## M. Mantenibilidad y tooling

### M-01. Handlers y módulos de métricas repiten el mismo código seis veces

**Descripción.** En `src/main/ipc/handlers/modules.ts:345-553` el patrón se repite seis veces
(`serviceMetrics`, `hostMetrics`, `processMetrics`, `monitorMetrics`, `monitorBreakdown`,
`hostBreakdown`): un cierre `query = (metricSelector, resolution?) => client.dtRequest({ …
path: '/metrics/query' … })` y un `catch` que reenvuelve `BAD_REQUEST`/`NOT_FOUND` en un `DtError`
con `params: { status: error.status ?? 0, detail: error.message }`, cambiando solo la clave del
`reason`. Además, las diecinueve implementaciones empiezan con `repo.getEnvironment(environmentId)`
sin usar el resultado: una validación por efecto secundario que no se lee como tal.

En los módulos, las mismas funciones privadas están copiadas en cuatro ficheros: `seriesAt`,
`single`, `EMPTY` y la mezcla de `warnings`/`partial` en `host-metrics.ts:61-82`,
`process-metrics.ts:61-73`, `service-metrics.ts:61-67` y `monitor-metrics.ts:101-113`;
`lastValue` en `host-metrics.ts:70-76` y `host-breakdown.ts:79-85`; `byEntity`, `entitiesOf` y los
comparadores en `host-breakdown.ts:65-108` y `monitor-breakdown.ts:100-136`. Ya hay una pequeña
divergencia: `single` devuelve `null` si `values[0]` es `undefined` en los módulos de entidad,
mientras `host-breakdown.ts:88-90` usa `?? null` (equivalente hoy, pero son dos verdades).

**Impacto: medio.** Un arreglo (el criterio de «último punto con dato», cómo se deduplican los
avisos, qué códigos se reenvuelven) hay que hacerlo en cuatro a seis sitios y es fácil que uno se
quede atrás.

**Esfuerzo: medio.**

**Ficheros.** Los seis módulos citados, `src/main/ipc/handlers/modules.ts`, sus tests.

**Relaciones.** Canales `entities:serviceMetrics`, `hostMetrics`, `hostBreakdown`,
`monitorMetrics`, `monitorBreakdown`, `processMetrics`. El contrato IPC no cambia. Las
**expresiones** de métrica (los selectores probados en vivo) no se tocan: `src/main/CLAUDE.md`
exige que cada una sea exactamente la probada.

**Solución propuesta.**

- Nuevo módulo puro `src/main/modules/metric-series.ts` con `seriesAt`, `singleValue`,
  `lastValue`, `seriesByDimension`, `namesOf`, `compareDesc`/`compareAsc` y
  `mergeMeta(responses) => { warnings, partial }`. Los módulos quedan con sus selectores y su
  `toXxx`.
- En el handler, `createMetricsQuery(client, envId, range)` que devuelve la función `query`, y
  `rethrowRejected(error, reasonKey)` que encapsula el `catch`. Y un `requireEnvironment` (o
  renombrar la llamada actual) que diga lo que hace.
- Tests: `metric-series.test.ts` con los casos de borde (serie vacía, último punto a `null`,
  dimensión ausente, avisos duplicados); los tests actuales de cada módulo y del handler se
  mantienen como regresión sin tocar sus expectativas; `npm run test:e2e:affected` sobre las
  páginas de entidad.

**Explicación.** Copiar y pegar es rápido la primera vez y caro cada vez siguiente. Cuando seis
trozos de código tienen que decir lo mismo, el proyecto necesita que lo digan una sola vez; si no,
las correcciones se aplican a medias y los módulos se separan en silencio.

### M-02. Las páginas de entidad repiten acceso, marcadores y tablas

**Descripción.** Copias casi literales en `src/renderer/src/pages/entities/`:

- Bloque de acceso y hooks de página (unas veinte líneas idénticas salvo el esquema del id y el
  hook de métricas): `HostEntityPage.tsx:33-53`, `ServiceEntityPage.tsx:28-46`,
  `ProcessEntityPage.tsx:31-49`, `MonitorEntityPage.tsx:45-67`. Incluyen la sutileza de la ficha
  0015 (`useConnectionStatusKnown` antes de pedir `entities:get`), que hay que recordar copiar bien
  en el quinto tipo.
- Marcadores: `HostMarkers.tsx:142-223`, `ProcessMarkers.tsx:189-245` y
  `MonitorMarkers.tsx:189-246` definen cada uno su `LEVEL_CLASS`, `MarkerBody` y `BigValue`, con
  firmas que ya han divergido. `UsageLevel` (`lib/host-format.ts`) y `AvailabilityLevel`
  (`lib/monitor-format.ts`) son el mismo tipo.
- Tablas: `HostTables.tsx:76-119` y `MonitorTables.tsx:87-130` tienen el mismo `TableCard`, los
  mismos `BAR_CLASS`, `LEVEL_TEXT_CLASS` y `NUMBER_CELL`; `compareNullable` y `byNumber` repetidos
  en `host-tables.ts:24-34` y `monitor-tables.ts:36-46`.

**Impacto: medio.** Cada tipo nuevo (`PROCESS_GROUP`, `APPLICATION`, `CLOUD_APPLICATION`, todos
«en construcción» en `registry.ts` y ya con fichas aprobadas 0031–0034) multiplica las copias, y
los umbrales y colores pueden divergir sin que ningún test lo vea.

**Esfuerzo: medio.** Conviene hacerlo **antes** de las fichas 0031–0034, o en ellas.

**Ficheros.** Los ocho citados, `EntityMarkers.tsx` (donde ya viven las piezas comunes),
`@shared/grid-sort.ts`, `e2e/areas.json`.

**Relaciones.** `data/modules.ts`, `data/tenants.ts`; e2e de entidades en `views.spec.ts` (los
`data-testid` con prefijo `host-marker-*`, `process-marker-*`, `monitor-marker-*` deben seguir
iguales); tests de `locales/*-page.test.ts`; regla de `src/renderer/CLAUDE.md` («un tipo nuevo
reutiliza esas piezas»).

**Solución propuesta.** `pages/entities/entity-access.ts` con `useEntityPageAccess(id, schema)` que
devuelva los entornos, accesos, `refresh` y `canFetch`; en `EntityMarkers.tsx`, un `Level`
compartido, `LEVEL_CLASS` y un único `MarkerBody`/`BigValue` con `testIdPrefix`; un
`EntityTables.tsx` con `TableCard<T>`, clases y `barWidth`; los comparadores a
`@shared/grid-sort.ts` con tests. Lo cubren los e2e existentes de las cuatro páginas; añadir área en
`areas.json` para los ficheros nuevos.

**Explicación.** La regla de la carpeta se cumplió para gráficos y franja, pero no para el bloque de
acceso ni para los marcadores. Una corrección (por ejemplo, el umbral del 80 %) hay que hacerla en
tres sitios y nada avisa si se olvida uno.

### M-03. `memo` sin efecto y un React Compiler que no existe

**Descripción.** `src/renderer/src/components/DataGrid.tsx:98-155` envuelve `GridRow` en `memo`
(«una fila solo se vuelve a pintar si cambian sus datos, su selección o si es la que tiene el
foco») y pide funciones con referencia estable. Pero quienes usan el grid crean esas props en cada
render: `ProblemsTable.tsx:91-95` (`status`), `:97-132` (`columns`, con `t(...)` dentro), `:143`
(`onActivate` inline); `EvidenceSection.tsx:625-628`, `:631-733`, `:913`, `:926-927`;
`HostTables.tsx` y `MonitorTables.tsx` igual. `memo` ve props distintas siempre y todas las filas se
pintan de nuevo. En Problemas, cada cambio de la primera fila visible durante el scroll
(`setScrollIndex` en el store) repinta hasta 199 filas con sus tooltips de Radix; en las
evidencias, cada tecla del buscador.

Lo que lo agrava: `DataGrid.tsx:235` y `src/renderer/CLAUDE.md:12` hablan del React Compiler como
si estuviera activo, y no lo está: `electron.vite.config.ts` usa `react()` sin plugins de Babel y
`package.json` no tiene `babel-plugin-react-compiler` (`grep` vacío). Lo que hay son las **reglas de
lint** del compilador (`eslint-plugin-react-hooks` 7), que avisan como si existiera. El código está
escrito como si se memoizara solo, y no se memoiza.

**Impacto: medio.** Scroll y filtrado menos fluidos en listas de 100 a 200 filas (la API devuelve
hasta 500 problemas); no se nota en los e2e porque los fixtures son pequeños. Y una expectativa
falsa que irá dejando más fugas de este tipo.

**Esfuerzo: medio.** Decisión de Dani entre dos vías; la segunda es pequeña en código pero añade
una dependencia y cambia el build (ficha + ADR).

**Ficheros.** `components/DataGrid.tsx`, `ProblemsTable.tsx`, `EvidenceSection.tsx`,
`pages/entities/HostTables.tsx`, `MonitorTables.tsx`, `electron.vite.config.ts`,
`src/renderer/CLAUDE.md`, `docs/ARCHITECTURE.md`.

**Relaciones.** `app/problem-filters.ts`, `app/evidence-table.ts`, TanStack Virtual; e2e de
`views.spec.ts` que hacen scroll y teclado en el grid.

**Solución propuesta.** Una de las dos, no las dos a medias:

1. **Sin compilador** (la honesta con el código actual): `useMemo` para `columns`, `useCallback`
   para `status`/`onActivate`, o sacar `columns` a una función pura `problemColumns(t, lang)`
   memoizada. Corregir los comentarios y aclarar en `src/renderer/CLAUDE.md` que solo están las
   reglas de lint.
2. **Con compilador**: `npm install --save-exact babel-plugin-react-compiler` y `react({ babel: {
plugins: ['babel-plugin-react-compiler'] } })`. Entonces `memo` y los `useCallback` sobran y los
   comentarios pasan a ser ciertos. Vigilar `DataGrid` (ya marcado como incompatible) y `Chart`
   (refs mutables).

Medición antes y después: un contador de renders en `GridRow` solo bajo `VIGIA_E2E`, y un e2e que
compruebe que hacer scroll de diez filas no repinta las 199.

**Explicación.** `memo` compara las props por referencia; una función o un array creados en el
render son nuevos siempre, así que el `memo` no hace nada y además cuesta una comparación por
fila. El React Compiler lo haría solo, pero solo si está instalado como plugin de Babel: las reglas
de ESLint no transforman nada.

### M-04. `views.spec.ts`: el 81 % de los e2e en un solo fichero

**Descripción.** `e2e/views.spec.ts` tiene 11 925 líneas y 176 tests; el resto de specs suman 2 790
líneas y 93 tests. Con `workers: 4` y un spec por worker (`playwright.config.ts:9`), tres workers
acaban pronto y el tiempo total del e2e es el de `views`. Es el único spec con portapapeles del
sistema, lo que obliga a `--workers=1` en algunos casos. Un fallo del `beforeAll`
(`views.spec.ts:3616-3665`) tumba 176 tests de golpe.

**Impacto: medio.** Tiempo de verifier y CI en cada ficha; 530 KB en un fichero.

**Esfuerzo: grande.**

**Ficheros.** `e2e/views.spec.ts`, `e2e/areas.json`, `scripts/affected-e2e.cjs` y sus tests,
`e2e/CLAUDE.md`, `docs/flujo.md`.

**Relaciones.** e2e, `test:e2e:affected`, verifier, CI.

**Solución propuesta.** Extraer el arranque común (simulador, `createEnvironment`, `resetState`,
`afterEach` de seguridad) a `e2e/views-fixture.ts` y partir por módulo: `views-problems`,
`views-metrics`, `views-entities`, `views-export`… Los tests del portapapeles, en un spec pequeño
dentro de un `project` de Playwright con `workers: 1`, o con un portapapeles simulado inyectado en
main solo bajo `VIGIA_E2E`. Un área por módulo en `areas.json` para que `affected` sea más fino.
Hacerlo en varias fichas (una por módulo extraído) para que cada una sea revisable.

**Explicación.** Playwright paraleliza por fichero; el más largo marca la duración. Partirlo
convierte cuatro workers en cuatro workers reales y acota el radio de un fallo de `beforeAll`.

### M-05. ESLint sin reglas con tipos (promesas sueltas)

**Descripción.** `eslint.config.mjs:13` usa `tseslint.configs.recommended` del toolkit de Electron,
que no activa reglas con información de tipos; el paquete ofrece `recommendedTypeChecked`. El código
ya evita promesas sueltas a mano (`src/main/index.ts:54`: `void app.whenReady()…`), señal de que
la regla encajaría.

**Impacto: bajo-medio.** Un `await` olvidado en un handler IPC o en un `afterAll` de e2e es un
fallo silencioso clásico (el test pasa sin esperar).

**Esfuerzo: medio.** Configurar `parserOptions.projectService` para los dos tsconfig y arreglar lo
que salga; medir el tiempo del lint (el `pre-commit` lo ejecuta).

**Ficheros.** `eslint.config.mjs`.

**Relaciones.** `check`, `pre-commit`.

**Solución propuesta.** Activar como mínimo `@typescript-eslint/no-floating-promises`,
`no-misused-promises` y `await-thenable` con `projectService: true`; valorar
`recommendedTypeChecked` entero en una segunda ficha si el tiempo lo permite.

**Explicación.** ESLint sin tipos no sabe qué devuelve una función; con el programa de TypeScript
detrás, sabe que `foo()` es una promesa y que nadie la espera.

### M-06. `pre-commit` no pasa `typecheck` a e2e y valida el disco, no el índice

**Descripción.** `.githooks/pre-commit:33-40`: si todo lo commiteado es `*.test.ts`, `e2e/` o
`src/test/`, solo corre ESLint sobre esos ficheros («solo tests; no se exige que pasen»). La
intención (tests del test-writer que importan código aún inexistente) es correcta para
`src/**/*.test.ts`, pero los specs de `e2e/` y los helpers de `src/test/` están en
`tsconfig.node.json` y nunca importan código futuro: un error de tipos ahí solo lo ve el verifier o
el CI. Además `:5` toma los nombres del índice y `:28` y `:42-46` leen los ficheros del disco: con
cambios parcialmente añadidos (`git add -p`) se valida algo distinto de lo que se commitea.

**Impacto: bajo-medio.** El verifier lo tapa dentro del flujo con agentes; sin él (Dani a mano), un
spec e2e roto llega a `main` y el CI lo cuenta después del push.

**Esfuerzo: pequeño.**

**Ficheros.** `.githooks/pre-commit`, `docs/flujo.md`.

**Relaciones.** Hooks; flujo del test-writer.

**Solución propuesta.** En la rama «solo tests», si la lista incluye `^e2e/` o `^src/test/`,
ejecutar también `npm run --silent typecheck:node`. Añadir `git diff --quiet -- $files || fail "hay
cambios sin añadir en ficheros del commit"` o documentar en `docs/flujo.md` que el hook valida el
árbol de trabajo.

**Explicación.** Un hook que valida menos de lo que cree da una falsa sensación de puerta. Que el
test-writer pueda commitear tests rojos es una excepción deliberada; los e2e no están en esa
excepción.

### M-07. El CI no conserva capturas ni logs de un e2e fallido

**Descripción.** `e2e/failure-capture.ts:20-40` adjunta a cada test fallido la captura de la
ventana y las últimas 80 líneas de `main.log` (en `test-results/`), pero `ci.yml` no tiene ningún
`upload-artifact` y `playwright.config.ts:17` solo usa el reporter `list`. Un rojo en CI que no se
reproduzca en la VPS (pantalla 1024×768, fuentes del servidor, UTC: los casos que `e2e/CLAUDE.md`
enumera) deja solo texto.

**Impacto: medio.** Depurar diferencias VPS/CI a ciegas ya ha costado fichas (0005, 0021).

**Esfuerzo: pequeño.**

**Ficheros.** `.github/workflows/ci.yml`, `playwright.config.ts`.

**Relaciones.** CI, e2e; S-04 (la acción, fijada por SHA).

**Solución propuesta.** Tras `npm run test:e2e`, `actions/upload-artifact` con `if: failure()`,
`path: test-results/`, `retention-days: 7`. Opcional: reporter `html` con `open: 'never'` y subir
`playwright-report/`. Los e2e usan simuladores sin datos del tenant, así que publicar las capturas es
seguro.

**Explicación.** El artefacto se genera ya; solo hay que guardarlo donde se pueda ver.

### M-08. Casts `as` sobre valores que vienen de disco

**Descripción.** `src/main/tenants/repository.ts:28-35` convierte columnas de texto a enums con
`row.type as Environment['type']`, `row.deployment as …`, `row.certificateLevel as …`. Si la base
contiene un valor fuera del enum (edición manual, una migración futura), el objeto pasa por válido
hasta la validación de salida del IPC, donde `tenants:list` falla entero con `INVALID_OUTPUT`
(todos los entornos, no solo el raro). `src/main/tenants/config-file.ts:17-22` usa `as Omit<…>`
tras un `delete` sobre un `Partial`, correcto pero ilegible. `src/main/dynatrace/client.ts:436-440`
castea el resultado de `paginate` a un `Record` para leer `nextPageKey`.

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** `src/main/tenants/repository.ts`, `src/main/tenants/config-file.ts`, tests.

**Relaciones.** `tenants:list`, `environments:*`, `config:export`.

**Solución propuesta.** En `toEnvironment`, validar con `environmentSchema.safeParse(row)` y, si
falla, registrar la fila por `id` (sin valores) y excluirla con aviso, o aplicar un valor seguro
(`type: 'other'`, `deployment: 'saas'`, `certificateLevel: 'system'`); test con una fila con
`type: 'legacy'`. En `withoutIds`, desestructurar en vez de `delete` + `as`.

**Explicación.** `as` le dice al compilador «confía en mí» y apaga la comprobación. Es aceptable
sobre datos que acaba de producir el propio código; sobre datos que vienen de disco o de red, lo
que se gana en comodidad se paga en un fallo lejos de donde se originó.

### M-09. Fechas formateadas por libre con `Intl.DateTimeFormat`

**Descripción.** La app tiene `formatDateTime` (`@shared/format-date`) y `dateLang`. Tres sitios
crean su propio formato corto: `components/EnvStatusCard.tsx:73-76` (caducidad de OAuth),
`components/ExportMenu.tsx:138` (pie de las capturas) y `settings/ConnectionPanel.tsx:103-106`
(caducidad del token). La caducidad sale como `9/10/26, 12:00` y la misma fecha en una tabla como
`09/10/2026 12:00`. El test que vigila `new Intl.NumberFormat` por libre no cubre
`DateTimeFormat`.

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** Los tres citados, `src/shared/format-date.ts`, el test de «sin `Intl` por libre».

**Relaciones.** `capture:image` (el pie de la captura cambia de texto; el e2e que lo lea), tarjeta
de estado, «Probar conexión».

**Solución propuesta.** Sustituir los tres por `formatDateTime(ms, dateLang(i18n.language))` o
añadir `formatDateTimeShort` en `@shared/format-date` con test. Ampliar el test a
`new Intl.(NumberFormat|DateTimeFormat)(` dejando `Intl.Collator` en lista blanca.

**Explicación.** Una sola función de fecha es lo que permite que el día y la hora se lean igual en
toda la app y que cambiar el formato sea un cambio de una línea con su test.

### M-10. Código y ramas que no pueden ejecutarse en producción

**Descripción.**

- `src/shared/ipc.ts:133-141` y `src/main/ipc/handlers/app.ts:38-41`: el canal `app:ping`,
  «canal de ejemplo de la Fase 1», solo lo usa `e2e/smoke.spec.ts` (para probar el recorrido
  renderer → preload → main y la validación de entrada). El renderer no lo llama.
- `src/main/export/xlsx.ts:26,133,137-147`: el reparto en varias hojas se activa a partir de
  `EXCEL_MAX_ROWS = 1_048_575`, pero el IPC no deja pasar más de `MAX_EXPORT_ROWS = 100_000`. Solo
  se ejecuta en tests. Además `partSheetName` (`:102-106`) podría chocar con una hoja del usuario
  llamada «Datos 2», cosa que la validación de nombres de `export:workbook` no contempla.
- `src/shared/modules.ts:515` (`steps: … .nullable()`, comentario «hoy ninguno») y
  `monitor-breakdown.ts:187-193`: `steps` nunca es `null`; el renderer mantiene la rama
  (`MonitorTables.tsx:270`).
- `src/main/modules/entities.ts:161-168` (`entityIdSelector`) lanza un `Error` sin `reason`
  inalcanzable: los ids ya llegan validados por `entityIdBatchSchema`.
- `locales/es/common.json:1033` y `en`: `entities.service.info.namesError` no se usa en ningún
  sitio (el error lo pinta `entities.service.markers.loadError`). Es la única clave sin uso de
  1070; `locales.test.ts` comprueba paridad es/en, no uso.

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** Los citados; `locales/locales.test.ts`.

**Relaciones.** `e2e/smoke.spec.ts` (si se quita `app:ping`, su prueba del recorrido se hace con
`app:getInfo` y la de validación con otro canal con entrada, por ejemplo `app:copyText` con texto
vacío); `export:*`; `entities:monitorBreakdown`.

**Solución propuesta.** Quitar `app:ping` del contrato (los e2e usan `app:getInfo` y `app:copyText`).
Quitar el reparto de hojas y `EXCEL_MAX_ROWS` con sus tests, o documentar que es defensa para cuando
suba `MAX_EXPORT_ROWS` y añadir la colisión «nombre N» al refine de `export:workbook`. Hacer `steps`
no nullable (contrato y renderer). Convertir el `Error` de `entityIdSelector` en un
`DomainError('INVALID_INPUT', …)` con `reason`, con comentario de defensa en profundidad. Borrar la
clave i18n y añadir en `locales.test.ts` un test de claves sin uso (aplanar y buscar en
`src/renderer/src/**`, con lista blanca de familias resueltas en runtime: `errorReasons.*`,
`dtErrors.*`, `environmentTypes.*`, …).

**Explicación.** El código que no puede ejecutarse no está probado por la realidad, solo por los
tests que lo invocan a propósito; con el tiempo nadie sabe si sigue siendo correcto. Mejor quitarlo
o dejar escrito por qué se conserva.

### M-11. Dos vías de transacción para lo mismo

**Descripción.** `src/main/tenants/repository.ts:118-120` expone `repo.transaction(fn)` (usado por
`applyConfigImport`) y `src/main/local-data.ts:60` inyecta en `TenantHandlerDeps` otra
`transaction: (fn) => db.$client.transaction(fn)()` idéntica, usada en `environments:update`
(`handlers/tenants.ts:62,123`). Son el mismo código en dos sitios, y el handler ya recibe `repo`.

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** `src/main/local-data.ts`, `src/main/ipc/handlers/tenants.ts`, `tenants.test.ts`.

**Relaciones.** `environments:update`, `config:import`.

**Solución propuesta.** Quitar `transaction` de `TenantHandlerDeps` y usar `repo.transaction` en el
handler; en los tests, el repositorio real sobre `:memory:` ya la tiene.

**Explicación.** Dos vías para lo mismo obligan a preguntarse cuál usar y permiten que una cambie y
la otra no.

### M-12. Esperas fijas en los e2e

**Descripción.** 24 usos de `waitForTimeout`: `e2e/views.spec.ts` (21), `errors.spec.ts:198,244`
(2 500 y 6 500 ms, ligados a la cuenta atrás de 5 s) y `smoke.spec.ts:253` (500 ms). Casi todas son
aserciones negativas con comentario (esperan un margen para comprobar que no ha pasado nada);
`views.spec.ts:5096` espera 1 100 ms para superar un umbral de caché de la app. No hay `test.only`
ni `skip` olvidados (`forbidOnly: true`).

**Impacto: bajo.** Unos 20 s por pasada; el riesgo real es que una espera dependa de una constante
de la app que cambie sin que el test lo sepa.

**Esfuerzo: medio.**

**Ficheros.** `e2e/errors.spec.ts`, `e2e/views.spec.ts`, `src/shared` (constantes de tiempo).

**Solución propuesta.** (a) Un helper `expectNothingFor(ms, check)` que encapsule las negativas.
(b) Para los timers del renderer (cuenta atrás, caché), `page.clock.install()` y
`page.clock.runFor(...)` de Playwright: el test deja de dormir y de depender del reloj real.
(c) Exportar las constantes de tiempo desde `src/shared` y leerlas en el spec.

**Explicación.** Una espera fija prueba «no ha pasado en N ms», no «no pasa nunca»; con el reloj
virtual la aserción es exacta y el test tarda milisegundos.

### M-13. Alias repetidos en cinco configuraciones; Vitest sin `@renderer`

**Descripción.** `@shared` se define en `electron.vite.config.ts:6`, `vitest.config.ts:6`,
`vitest.live.config.ts:11`, `tsconfig.node.json:22-24` y `tsconfig.web.json:13-15`. `@renderer` solo
existe en Vite y en `tsconfig.web.json`: los diez tests de `src/renderer/src/**/*.test.ts` corren
en Vitest sin ese alias; hoy importan en relativo, pero un test que use `@renderer/...` pasará `tsc`
y fallará en Vitest. La cobertura excluye el renderer entero (`vitest.config.ts:16`) aunque tiene
tests unitarios.

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** Los cinco citados.

**Solución propuesta.** Un `alias.ts` en la raíz importado por los tres configs de Vite/Vitest, o
`vite-tsconfig-paths` (dependencia nueva: ficha) para derivarlos del tsconfig. Valorar incluir los
módulos puros del renderer (`app/`, `data/`, `lib/`, `components/*.ts`) en `coverage.include` con
umbral propio.

**Explicación.** Dos fuentes de verdad se desincronizan sin que nadie lo note hasta que un import
funciona en un sitio y no en otro.

### M-14. Ajustes menores de CI

**Descripción.** (a) `ci.yml:19-21`: `cancel-in-progress: true` por rama. En una cola `/tarea 0006
0007 0008` cada ficha hace su push; el CI de la 0006 se cancela cuando llega el de la 0007, y si la
0008 sale roja no se sabe cuál la rompió sin relanzar. El enlace del CI del aviso de Telegram apunta
a una ejecución cancelada. (b) `ci.yml:38`: `npx install-electron` descarga unos 100 MB en cada
ejecución; `setup-node` solo cachea `~/.npm`.

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** `.github/workflows/ci.yml`.

**Solución propuesta.** (a) `cancel-in-progress: false` (los runs se encolan) o `group:
ci-${{ github.sha }}`. (b) `actions/cache` (por SHA) sobre `~\AppData\Local\electron\Cache` con
clave `electron-${{ runner.os }}-<versión de package.json>`.

**Explicación.** Cancelar ahorra minutos cuando los pushes intermedios no importan; aquí cada push
es una ficha cerrada y su resultado se anota.

### M-15. Pequeños

- `package.json` declara `engines.node >=22` pero no hay `.npmrc` con `engine-strict=true`: npm solo
  avisa. Una línea; evita un «funciona en mi máquina» con Node 20.
- Los `tsconfig` heredan `strict` y añaden `noUncheckedIndexedAccess` y `noFallthroughCasesInSwitch`
  (bien). Faltan `exactOptionalPropertyTypes` y `noImplicitOverride`; el código ya usa el patrón
  que el primero exige (`src/test/live-client.ts:147`). Medir cuánto rompe antes de decidir.
- Texto traducible en aserciones e2e: `views.spec.ts:6033-6034`, `:6215`, `:6927`, `:7902-7903`
  usan literales en español en vez de claves del locale o `data-testid`, al contrario que el resto
  del fichero. Cinco cambios.
- `vitest related` del `pre-commit` no se dispara con cambios en `.github/workflows/ci.yml` ni en
  `e2e/areas.json`, aunque `scripts/ci-workflow.test.ts` y `scripts/affected-e2e.test.ts` los leen
  del disco. Lo cubre el CI; anotarlo en el hook o ejecutar esos tests cuando `files` toque esos
  ficheros.
- `src/main/dynatrace/client.ts:171`: para elegir entre platform token y OAuth se descifra el
  platform token (`readSecret`) y luego se vuelve a descifrar en `secretOrFail`: dos llamadas a DPAPI
  por petición de plataforma. Usar `status` (existe o no) para la decisión y `read` una sola vez.
- `src/main/ipc/handlers/connection.ts:36,48,71` y los diecinueve handlers de módulos llaman a
  `repo.getEnvironment(id)` descartando el resultado para que lance `NOT_FOUND`. Un alias
  `repo.requireEnvironment(id)` (o un comentario de una línea) deja claro que es una validación y no
  una llamada olvidada (ver M-01).

---

## Qué no se ha revisado

- Las pruebas en vivo (`*.live.test.ts`) no se han ejecutado; C-15 queda pendiente de una.
- El zip empaquetado no se ha generado ni arrancado (S-06 lo necesita, en perfil de prueba).
- No se ha medido rendimiento real del renderer con listas grandes (M-03 propone cómo medirlo).
- `docs/especificacion.md` (local, no versionado) no se ha consultado: si alguna decisión de las
  propuestas ya está cerrada ahí, prevalece.
