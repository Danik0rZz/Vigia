# Flujo de trabajo

Cómo se trabaja en Vigía con agentes (ADR-0007). El `CLAUDE.md` raíz tiene el resumen; aquí está
el detalle. El repositorio es la única memoria: los agentes arrancan vacíos y se ponen al día
leyendo. Si algo no está escrito, para ellos no existe.

## Quién es quién

| Quién        | Dónde                                  | Qué hace                                                                                 |
| ------------ | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Dani         | —                                      | Pide, decide y aprueba. Prueba a mano (`docs/pendiente-dani.md`).                        |
| Planificador | Sesión 1 (antes, peticiones)           | Convierte peticiones en fichas, o en lotes. Decide en nombre de Dani si lo delega.       |
| Orquestador  | Sesión 2 (worktree propio)             | `/tarea NNNN [MMMM …]` (en cola) y `/cerrar-version`. Coordina; no escribe código.       |
| test-writer  | Subagente del Orquestador              | Tests desde la ficha, antes del código. Tienen que fallar.                               |
| developer    | Subagente del Orquestador              | Implementa hasta verde. No toca los tests.                                               |
| reviewer     | Subagente del Orquestador              | Revisa el diff sin contexto previo. Solo lectura. (Antes, senior.)                       |
| verifier     | Subagente del Orquestador              | Repite `check` y los e2e afectados en un worktree limpio. (Antes, test.)                 |
| doc-writer   | Subagente del Orquestador              | CHANGELOG, BACKLOG, ADR, ARCHITECTURE y el resultado de la ficha.                        |
| Hooks de git | `.githooks/` (sin IA)                  | Pre-commit: lint, tipos, formato y unitarios relacionados. Pre-push: escaneo del tenant. |
| CI           | GitHub Actions (sin IA)                | `check`, e2e completo y `dist:win` en Windows en cada push a `main`.                     |
| Aviso        | `scripts/notify-telegram.mjs` (sin IA) | Mensaje a Telegram al terminar `/tarea` o `/cerrar-version`. Opcional.                   |

Cada subagente es una instancia nueva: el reviewer de la ronda 2 no es el de la ronda 1. El encargo
que les pasa el Orquestador es corto (la ruta de la ficha y, si acaso, una nota); el resto lo leen.
El doc-writer y el verifier, que hacen trabajo mecánico, van con un modelo más rápido (`model:
sonnet` en su definición); el resto, con el de la sesión (ADR-0010).

## Cómo se arranca

- **Sesión 1 (Planificador):** `claude --agent planner`, en el checkout principal. Se le habla en
  lenguaje normal: "quiero…".
- **Sesión 2 (Orquestador):** `claude` en el worktree `Orquestador` y `/tarea NNNN` con una ficha
  aprobada, o `/tarea NNNN MMMM …` con varias en cola. Al cerrar una versión, `/cerrar-version`.
- **Responder desde el móvil:** en cada sesión, `/remote-control` (o arrancarla con
  `claude remote-control`) y abrirla desde la app de Claude, en **Code**. Desde ahí se contesta a
  una pregunta o se aprueba un permiso como en el PC. El PC tiene que seguir encendido con la sesión
  abierta. Para que la app también avise, en `/config`: "Push when actions required".
- **Una vez por clon:** `git config core.hooksPath .githooks` (activa los hooks de git; la
  configuración es del repositorio y la comparten todos sus worktrees).

## Ciclo de una ficha

```
borrador ──(Dani o peticiones)──▶ aprobada ──test-writer──▶ tests_escritos ──developer──▶ en_revision
   ▲                                                              ▲                           │
   │ cambio de alcance                                            │ CAMBIOS (máx. 3 rondas)   ▼
   └──────────── [ALCANCE] lo decide Dani ◀──── reviewer ─────────┴──────────── APROBADO
                                                                                      │
                     hecha ◀──doc-writer── verificada ◀──verifier (check + e2e)───────┘
                       │
                       └─▶ merge fast-forward a main ─▶ push (pre-push: scan:tenant) ─▶ CI
```

- `bloqueada`: tres rondas sin aprobar, un test que el developer cree incorrecto, una decisión que
  no está en el repositorio o un fallo del verifier que no se arregla en dos intentos. El
  Orquestador para y se lo dice a Dani (o al Planificador, si Dani lo ha delegado).
- `en_espera`: en una cola, la ficha espera una respuesta de Dani; su rama se queda y la cola sigue
  con la siguiente que no dependa de ella. Se retoma con `/tarea NNNN`.
- Una ficha por tarea, con su número correlativo (`tasks/NNNN-slug.md`, a partir de la plantilla).
- Las ideas que surgen no se implementan: van a "Ideas surgidas" y el doc-writer las pasa al
  BACKLOG.
- Las versiones no se cierran por ficha. El doc-writer apunta cada ficha en `## [Sin publicar]` del
  CHANGELOG, y `/cerrar-version` agrupa lo que haya cuando Dani (o peticiones) lo pide. Mientras se
  itera no hace falta cerrar: los cambios se ven con `npm run dev`. Se cierra cuando Dani quiere
  usar el zip fuera de la VPS o al acabar un bloque grande.

## Lotes, colas y fichas ligeras

Para ir más rápido sin perder las puertas (ADR-0010):

- **Lotes.** Dani pide algo grande de una vez («en Problemas quiero A, B, C y D»). El Planificador
  lo trocea en fichas pequeñas con un `lote` común, su orden y su `depende_de`, se las presenta
  juntas (con todas las preguntas a la vez) y Dani las aprueba de una vez. Las fichas siguen siendo
  pequeñas: un fallo solo para la suya, el reviewer ve diffs que puede revisar bien y cada una se
  deshace sola.
- **Colas.** `/tarea 0006 0007 0008` las hace en ese orden sin esperar a Dani entre una y otra,
  cada una desde el `main` que dejó la anterior y con su aviso. Si una espera a Dani o se bloquea,
  se avisa y la cola sigue con las que no dependen de ella. Al final, un aviso con el resumen.
- **Fichas ligeras** (`ligera: sí`, la marca el Planificador): solo para fichas S que no tocan
  canales IPC, la API de Dynatrace, dependencias, el esquema, la seguridad ni servicios externos.
  No hay test-writer: el developer escribe primero los tests (commit solo de tests) y después el
  código, y el reviewer comprueba además que los tests cubren cada criterio tal como está escrito.
  El reviewer, el verifier, los hooks y el CI no cambian.

## Quién decide

- **Lo deciden los agentes** y lo anotan en la ficha, en la spec o en un ADR: dudas de diseño,
  alcance dentro de una ficha, orden o interpretación de la spec.
- **Se escala a Dani:** lo destructivo o irreversible (lo aprueba él en la sesión que lo ejecuta),
  publicar algo nuevo hacia fuera, licencia, marca y temas legales, qué hacen las funciones sin
  definir, la API cuando no se puede deducir, retomar Monaco y los cambios de alcance que marca el
  reviewer (`[ALCANCE]`).
- **Peticiones (el Planificador) decide en nombre de Dani** cuando Dani lo ha delegado: aprobar
  fichas (`aprobada_por: peticiones`, con el motivo) y los `[ALCANCE]` que le pase el Orquestador
  (con `SendMessage` a la sesión del Planificador). Nunca lo que solo decide Dani.
- **Luz verde sin preguntar:** lo recuperable con git que ya esté commiteado (código, dependencias
  exactas, `node_modules`, `out`, `dist`, tests, empaquetar, commits, merge a `main` y push normal
  con el visto bueno del reviewer y del verifier), lecturas del tenant de pruebas y matar procesos
  del equipo.
- **Se pregunta a peticiones:** borrar o mover lo que no está en git (`docs/especificacion.md`,
  `%APPDATA%\vigia`, `.env.live.local`, `..\API\` y nada fuera del repositorio), escrituras en el
  tenant, cambios globales en la máquina, y `git reset --hard`, `checkout --`, `clean` o
  `stash drop` con cambios sin commitear (salvo commit o stash previo).
- **Solo lo decide Dani:** force push, reescribir el historial publicado, borrar ramas remotas,
  tags, releases, publicar el zip, licencia y temas legales, y el qué de las funciones sin definir.
  El zip nunca se arranca en su perfil.
- Antes de cada tanda grande de cambios en la spec, copia como
  `docs/.respaldo/especificacion.AAAAMMDD-HHmm.md` (carpeta ignorada), conservando las 5 últimas;
  borrar las más antiguas de esa carpeta está autorizado, y nada más.

## Git

- Cada ficha en su rama local `feat/NNNN-slug`, creada desde `main` en el worktree del Orquestador.
  Las ramas no se publican en GitHub.
- Integración: `main` está en el checkout principal (otro worktree), así que se integra desde ahí:
  `git -C <checkout principal> merge --ff-only feat/NNNN-slug` (la ruta sale de
  `git worktree list`). Si no es fast-forward, se rebasa la rama sobre `main` en el worktree del
  Orquestador, se repite el verifier y se vuelve a intentar. La rama se borra en local después.
- Push: solo `git push origin main`, y solo con el reviewer en APROBADO y el verifier en verde.
  Nunca `--force` ni `--force-with-lease`. Sin tags, releases ni subir el zip a GitHub.
- Antes de cada push (el pre-push lo hace solo): `npm run scan:tenant`. Además, revisar el contenido
  sensible: autor y committer noreply, sin `docs/especificacion.md`, sin nombres de clientes,
  secretos, URLs o IDs de tenants reales, logs ni `.env`.
- Commits pequeños por funcionalidad, en español, con el número de la ficha:
  `feat(problemas): agrupa por clúster (#0003)`. Tests para la lógica de main.
- En PowerShell, `git commit -F -` con un here-string no lee el mensaje de la entrada: escribir el
  mensaje en un fichero y usar `git commit -F <fichero>`.

## Niveles de prueba

- **Durante el desarrollo (developer):** `npm run check` y `npm run test:e2e:affected` (mientras se
  itera, `vitest related <ficheros>` o `--changed`).
- El e2e local ya corre con la ventana del CI (1024×720): los specs la fijan al arrancar la app.
- **Por ficha (verifier):** en un worktree propio en su scratchpad, `npm run check` y
  `npm run test:e2e:affected -- main..feat/NNNN-slug`. No repite lo que ya está en verde si el rango
  no cambió.
- **Transversal** (lo decide `e2e/areas.json`): e2e completo. Los locales y `main.css` no son
  transversales: los cubren el test de paridad y el de contraste (los dos en `check`) y disparan el
  área shell, más la del módulo si el diff toca uno. `scripts/**` está en ignore porque solo
  contiene herramientas de desarrollo; un script que intervenga en el build o el empaquetado va a
  `build/` o se saca del ignore.
- `--repeat-each 3` solo si se toca temporización (esperas, animaciones, virtualización,
  navegación) o hubo un fallo intermitente, en ese spec. `views` va con `--workers=1`.
- **Al cerrar una versión:** e2e completo dos veces, `--repeat-each 3` en los specs cambiados desde
  la versión anterior y `npm run dist:win`.
- **Clon limpio** (en el scratchpad, con la instalación del README, `npm run check`,
  `npm run test:e2e` completo y `npm run dist:win`) solo si cambian las dependencias, el
  empaquetado o la instalación (`package*.json`, scripts de npm, electron-builder). Comprobarlo en
  el árbol de trabajo no basta: ahí ya está todo instalado.
- Un criterio de aceptación manual no se da por cumplido; solo lo confirma Dani.

## Cerrar una versión

Lo hace `/cerrar-version` en la sesión 2 cuando Dani (o peticiones) lo pide:

1. Versión: menor si entra algo nuevo, parche si solo hay arreglos. Se sube en `package.json` y se
   pasa `## [Sin publicar]` del CHANGELOG a `## [x.y.z] - AAAA-MM-DD`.
2. El verifier ejecuta las pruebas de cierre (sección anterior) y, si toca, el clon limpio.
3. `docs/pendiente-dani.md`: una sección nueva con las "Pruebas a mano para Dani" de sus fichas,
   más "Arrancar el zip x.y.z sobre sus datos" (con o sin migraciones). **Antes, hacer una copia de
   `%APPDATA%\vigia`**; lo hace Dani.
4. "Estado" del `CLAUDE.md` raíz y, si cambia algo de lo acordado, `docs/especificacion.md`.
5. Un solo resumen para Dani, sin esperar su respuesta: lo hecho, las decisiones tomadas y lo que
   tiene que probar a mano. Tags, releases y subir el zip se escalan a Dani.

## Avisos por Telegram

Opcional (ADR-0009). El Orquestador llama a `node scripts/notify-telegram.mjs <json>` al terminar:

- `/tarea`: `hecha` (tras el push, con el enlace del CI), `bloqueada` (tres rondas sin aprobar, con
  el motivo) o `parada` (esperando una decisión de Dani, con la pregunta). Un `[ALCANCE]` que
  decide el Planificador por delegación no avisa.
- `/cerrar-version`: `cerrada` o `fallida` (con el motivo).
- Una cola de `/tarea`: un aviso por ficha y otro al final con el resumen (`parada` si alguna espera
  a Dani).
- El Planificador: `parada` cuando tiene una ficha o un lote listo para aprobar, o una pregunta que
  solo puede contestar Dani.

Las preguntas (`decision`) se escriben para contestarlas desde el móvil (sí/no u opciones
numeradas). Telegram solo avisa: la respuesta se da en la sesión, en el PC o desde la app de Claude
con Remote Control (ver "Cómo se arranca"). Recibir órdenes por Telegram (Channels de Claude Code,
en vista previa) queda fuera de momento (ADR-0010).

El mensaje es texto plano y corto: ficha o versión, título, estado, rondas, resultado del verifier,
la decisión que se espera de Dani si la hay, un resumen y el enlace del CI. Lo redacta el
Orquestador sin datos del tenant ni nombres de clientes; además, el script lo pasa por el filtro de
`scan:tenant` y, si encuentra algo, no lo envía.

- **Variables** (de usuario de Windows, nunca en el repositorio): `VIGIA_TELEGRAM_TOKEN` (token del
  bot) y `VIGIA_TELEGRAM_CHAT_ID`. Se fijan con `setx` (ver el README). Si la sesión se abrió antes,
  el script las lee del registro.
- **Nunca para el flujo:** sin variables, sin red o con un error de Telegram, sale con 0 y lo dice
  en la terminal con el prefijo `[aviso telegram]`, sin el token ni el chat_id.
- **Probarlo:** los tests (`npx vitest run scripts/notify-telegram.test.ts`) no usan la red. Para
  un envío real, un JSON en el scratchpad, por ejemplo
  `{ "tipo": "tarea", "ficha": "0000", "titulo": "Prueba", "estado": "hecha", "resumen": "Aviso de prueba", "rondas": 1, "verifier": "VERDE" }`,
  y `node scripts/notify-telegram.mjs <ruta-del-json>`.

## Pruebas en vivo

`npm run test:live`: solo lectura aunque el token permita escribir. Todo `*.live.test.ts` pasa por
`createLiveClient`, cuya guarda rechaza antes de la red cualquier método que no sea GET salvo
`POST /apiTokens/lookup`. Una petición detrás de otra, `pageSize` de 500 como máximo y pocas
páginas. Nunca leer ni mostrar `.env.live.local` (solo lo carga el proceso de test); nada del
tenant (nombres, IDs, URLs, valores) en el repositorio, en fichas, en fixtures ni en mensajes entre
sesiones. Los informes van a `live-reports/` (ignorado) y se resumen sin datos del tenant. En notas
y fixtures, solo tipos estándar de Dynatrace: los tipos de entidad, métricas, SLOs y eventTypes
personalizados o de extensión se describen por su forma y se cuentan, nunca por su nombre (ni en el
informe local). Nunca van al CI.

## Puertas sin IA

- **Pre-commit** (`.githooks/pre-commit`): si el commit toca algo que no sea Markdown, lint, tipos,
  formato y los tests unitarios relacionados con lo que se commitea. Si falla, el commit no existe.
- **Pre-push** (`.githooks/pre-push`): `npm run scan:tenant`.
- **CI** (`.github/workflows/ci.yml`): en cada push a `main` y a mano, en `windows-latest`,
  instalación del README, `npm run check`, `npm run test:e2e` y `npm run dist:win` (sin subir el
  zip). Sin `test:live` ni secretos: los logs del CI son públicos.
- **Permisos de Claude Code** (`.claude/settings.json`): niegan force push, tags y releases, y leer
  `.env*`.
- Ningún agente salta un hook (`--no-verify`) ni da por buenos unos tests en rojo.

## Windows y la shell

- Las rutas de Windows van entre comillas invertidas (`%APPDATA%\vigia`) y los documentos se editan
  con las herramientas de edición: una ruta escrita desde la shell perdió `\v`, que se convirtió en
  un carácter de control (0x0B). Un test de `npm run check` falla si un fichero versionado de texto
  tiene caracteres de control.
- `Set-Content -Encoding utf8` de PowerShell 5.1 escribe BOM, y `Get-Content -Raw` sin
  `-Encoding utf8` lee los ficheros como ANSI y estropea las tildes al reescribirlos. Para editar
  ficheros, usar las herramientas de edición, `sed` o `node`.
- Si `npm run dist:win` falla en Windows con un error de enlaces simbólicos, hace falta el Modo de
  desarrollador de Windows o una terminal de administrador.
- Carpeta de datos por modo: el zip usa `%APPDATA%\vigia`, `npm run dev` usa `%APPDATA%\vigia-dev`
  y cada e2e su carpeta temporal (`VIGIA_USER_DATA_DIR`, solo sin empaquetar). Es normal que en dev
  no aparezcan los datos del zip.
