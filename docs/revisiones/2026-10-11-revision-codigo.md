# Revisión de código: 2026-10-11

Revisión automática y periódica del código de Vigía (v0.11.0, `main` en `c617ca7`). Es un documento
para el Planificador y los agentes: cada hallazgo lleva lo necesario para convertirlo en una ficha
de `tasks/` y acometerlo con garantías. **No se ha modificado código**; solo se ha escrito este
fichero. Nada se empieza sin ficha aprobada por Dani (ADR-0007).

Es la segunda revisión. La primera (`2026-10-09-revision-codigo.md`) dio lugar a las fichas 0055 a
0064, todas hechas. Aquí **no se repite nada de aquella tabla**: lo que sigue abierto de ella está
al final, en "Pendiente de la revisión anterior", con su id original. Todo lo demás es nuevo.

## Cómo se ha hecho

- Lectura directa de las piezas nuevas de más riesgo: el limitador de peticiones
  (`dynatrace/concurrency.ts` y su uso en `client.ts`), la copia antes de migrar (`db/backup.ts`,
  `index.ts`), `scripts/integrate.mjs`, `scripts/ci-changes.mjs`, los dos workflows y los dos hooks.
- Tres revisiones en paralelo con ojos nuevos, cada una con su informe: main y preload; renderer y
  `shared`; tooling, CI, hooks, e2e y empaquetado. A cada una se le dio la tabla de la revisión
  anterior con la orden de no repetirla y la lista de lo escrito desde entonces (fichas 0046 a
  0073).
- Cada hallazgo que aparece aquí se ha contrastado después leyendo las líneas citadas. Lo que no se
  pudo confirmar se dice. Las líneas corresponden al commit indicado arriba.
- Nada se ha ejecutado: ni `check`, ni e2e, ni pruebas en vivo. **En este checkout no hay
  `node_modules`** (el primer paso del `CLAUDE.md` no está hecho), así que lo que depende del
  comportamiento real de electron-log, ExcelJS o `hast-util-sanitize` queda marcado como no
  verificado.
- Aquí no hay ningún dato del tenant de pruebas ni de clientes.

## Resumen

No hay ningún fallo de seguridad grave ni nuevo en la app. El código de las fichas 0057 a 0064 está
bien hecho (ver "Lo que está bien"). Lo que se propone es, sobre todo:

1. **Cerrar la puerta de publicación.** El pre-push comprueba el tenant pero no a dónde se hace
   push: `main`, borrados de ramas y pushes no lineales por refspec pasan el hook, y la regla
   «solo `integra/`» vive en prosa y en patrones de texto de `settings.json`. Con `main` aún sin
   proteger, es el hueco más importante del repositorio. Alrededor: el check «CI ok» que se lee en
   verde si la salida de `cambios` llega vacía, la fusión sin atar al commit que pasó el CI, el
   escaneo del tenant que no mira binarios ni nombres de fichero, y el aviso de Telegram que se
   envía cuando no puede filtrar.
2. **Un error de concurrencia real** en la renovación OAuth: varios 401 a la vez disparan varias
   renovaciones y la segunda tira el token que la primera acaba de conseguir.
3. **Reglas del proyecto incumplidas de forma visible**: números sin `formatNumber` (el KPI de
   Inicio entre ellos), búsquedas que piden a Dynatrace desde una letra (ADR-0004), un enlace sin
   ruta por teclado, textos en español que salen de main, y el filtro del log que cubre menos
   categorías que las barreras locales.
4. **Mantenibilidad**: dos criterios para reenvolver un rechazo de Dynatrace, restos de duplicación
   en las páginas de entidad nuevas, `EvidenceSection.tsx` con 945 líneas, y documentación que ya
   no cuadra con los scripts.

Impacto: **alto** = permite saltarse una regla "que no se salta", dar un verde falso en la cadena
de publicación, o afecta a datos, seguridad o cuota del cliente en uso normal; **medio** = fallo
real pero acotado, o regla del proyecto incumplida de forma visible; **bajo** = pulido, coherencia
o robustez ante cambios futuros. Esfuerzo: **pequeño** = una sesión, sin canal IPC nuevo; **medio**
= varios ficheros con tests; **grande** = reestructuración o decisión de Dani.

| Id   | Título                                                                     | Impacto    | Esfuerzo      | Zona           |
| ---- | -------------------------------------------------------------------------- | ---------- | ------------- | -------------- |
| T-01 | El pre-push no limita a dónde se hace push: `main`, borrados y force pasan | alto       | pequeño       | hooks/scripts  |
| T-02 | «CI ok» queda en verde si `windows` se salta por una salida vacía          | medio      | pequeño       | CI             |
| T-03 | La fusión no va atada al commit que pasó el CI; `[skip ci]` en un ADR      | medio      | pequeño       | flujo/docs     |
| T-04 | `affected-e2e.cjs` lanza Playwright con `shell: true` sin citar            | medio      | pequeño       | scripts        |
| T-05 | `scan:tenant` no mira binarios, nombres de fichero ni renombrados          | medio      | pequeño       | scripts        |
| T-06 | `integrate.mjs` solo se fía de `estado: verificada` y de la rama           | medio      | pequeño       | scripts        |
| T-07 | `notify-telegram` envía igualmente cuando no puede filtrar                 | bajo-medio | pequeño       | scripts        |
| T-08 | El pre-commit no ve los borrados y parte las rutas con espacios            | bajo-medio | pequeño       | hooks          |
| T-09 | `e2e-tags.cjs` no ve los tests cuyo título no es un literal                | bajo       | pequeño       | scripts        |
| T-10 | El parser del `.env` está tres veces y `test:live` solo mira el cwd        | bajo       | pequeño       | scripts/test   |
| T-11 | `execFileSync` sin `timeout` ni `maxBuffer` en tres scripts                | bajo       | pequeño       | scripts        |
| T-12 | Cobertura: `scripts/**` y `src/preload/**` fuera del umbral                | bajo       | pequeño       | tooling        |
| T-13 | Documentación que ya no cuadra con los scripts                             | bajo       | pequeño       | docs           |
| P-01 | Varios 401 a la vez con OAuth disparan N renovaciones                      | medio      | pequeño       | main/dynatrace |
| P-02 | El log de main escribe el nombre de usuario de Windows en las rutas        | bajo-medio | pequeño       | main/logging   |
| P-03 | `maskLogMessage` solo mira el primer nivel                                 | bajo-medio | pequeño       | main/logging   |
| P-04 | Dos criterios para reenvolver un rechazo de Dynatrace con `reason`         | bajo-medio | pequeño-medio | main/ipc       |
| P-05 | Las etiquetas de hoja del XLSX no pasan por `sheetNameSchema`              | bajo       | pequeño       | shared/export  |
| P-06 | Cancelación a medias: la espera del 429 no se aborta; el 401 no cancela    | bajo       | pequeño       | main/dynatrace |
| P-07 | Errores tragados sin rastro: `environmentOf` y `processGroupTotal`         | bajo       | pequeño       | main           |
| P-08 | El 3xx del SSO da `ssoUnreachable` con texto de librería; CLAUDE.md miente | bajo       | pequeño       | main/dynatrace |
| P-09 | Textos en español que main manda al usuario, fuera de los locales          | bajo       | pequeño       | main           |
| P-10 | `asRecord`/`asString` copiados en cinco módulos                            | bajo       | pequeño       | main/modules   |
| R-01 | Números sin `formatNumber`, incluido el KPI de Inicio                      | medio      | pequeño       | renderer       |
| R-02 | Búsquedas que piden a Dynatrace por cada texto, desde una letra            | medio      | pequeño       | renderer       |
| R-03 | El enlace al host de la tabla de instancias no se alcanza con teclado      | medio      | pequeño       | renderer       |
| R-04 | Consultas locales sin `staleTime`: se repiten en cada montaje              | bajo-medio | pequeño       | renderer       |
| R-05 | `EvidenceSection.tsx` tiene 945 líneas                                     | medio      | medio         | renderer       |
| R-06 | Visor de Markdown: dos comentarios que ya no son ciertos                   | bajo       | pequeño       | renderer       |
| R-07 | `parseColor` resuelve nombres por el prototipo de `NAMED_COLORS`           | bajo       | pequeño       | renderer       |
| R-08 | Restos de duplicación en las páginas de entidad                            | bajo       | pequeño       | renderer       |
| R-09 | Pequeños del renderer (`fromProblem`, filas pulsables, gráfico vacío, key) | bajo       | pequeño       | renderer       |
| R-10 | Contrato IPC: asimetrías menores                                           | bajo       | pequeño       | shared         |

Lotes sugeridos (ADR-0010 y ADR-0014), por orden:

- **puerta-de-publicacion**: T-01 + T-02 + T-03 + T-05 + T-07. Tocan hooks, CI y scripts de
  seguridad: `exclusiones: [seguridad]`, PR sola, la fusiona Dani. Conviene antes de que Dani active
  la protección de `main` (BACKLOG, tras la 0073), porque T-01 y T-03 son justo lo que esa
  protección completará.
- **tooling-robusto**: T-04 + T-06 + T-08 + T-09 + T-10 + T-11 + T-12 + T-13. Sin exclusiones;
  ficha ligera cada dos o tres.
- **cliente-dynatrace**: P-01 + P-06 + P-08. `exclusiones: [api]` por tocar el cliente y el SSO
  (sin endpoint nuevo).
- **log-ultima-barrera**: P-02 + P-03. P-03 ya está anotado en el BACKLOG como `[ALCANCE]` de la
  0060: lo decide Dani.
- **main-coherencia**: P-04 + P-07 + P-09 + P-10. Sin canal IPC nuevo.
- **contrato-ipc**: P-05 + R-10. `exclusiones: [ipc]`, PR sola.
- **renderer-reglas**: R-01 + R-03 + R-09 (fichas ligeras). R-02 pide una decisión de Dani (mínimo
  de letras y si el filtro de Problemas se aplica con Enter). R-04 sola. R-06 + R-07 juntas (visor).
  R-08 sola. R-05 en ficha normal, con test-writer.

---

## Lo que está bien (comprobado, no tocar)

- **Limitador de peticiones (0062).** `concurrency.ts` y `client.ts:347-371`: el sitio se toma
  antes del plazo y se suelta en `finally`, también cuando `fetch` lanza, cuando el cuerpo falla y
  antes de dormir el 429; `release` es idempotente; el sitio pasa al siguiente de la cola sin tocar
  `active`; una cancelación en cola la saca sin ocupar sitio; nadie pide sitio teniendo otro. El log
  de la cola solo lleva el id interno y el número de pendientes.
- **Copia antes de migrar (0061).** `backup.ts`: origen `readonly` con `fileMustExist`, cerrado en
  `finally`; el criterio de pendiente (`created_at < when`) es el del migrador de Drizzle; nunca pisa
  un fichero existente; una copia a medias se borra solo si es la propia; la poda filtra por patrón
  y nunca borra la recién hecha. `index.ts` toma el bloqueo de instancia única antes de copiar y
  migrar, y un fallo de la copia impide migrar.
- **Caídas (0061).** `crash-policy.ts` puro con reloj y acciones inyectadas; `killed` cuenta; una
  recarga por minuto; textos es/en con test de paridad.
- **Redirecciones (0060).** `redirect: 'error'` en los dos `fetch`; `redirectRefused` sin URL ni
  destino; tests contra servidores locales que comprueban que el destino no recibe nada.
- **Hook de log (0060).** Registrado una vez para todos los transportes, también las excepciones de
  `startCatching`; `maskError` no modifica el original.
- **Métricas (0057 y módulos nuevos).** Ids validados por esquema antes de entrar en comillas
  (`host-events.ts` vuelve a validar los que vienen de la API); ninguna consulta pasa de 10
  expresiones; `metric-series-guard.test.ts` vigila las copias; `entity-secrets.ts` quita las
  propiedades de log enteras.
- **Exportación (0063).** `toExcelLocal` coherente entre celdas e Info; TXT sin spread; CSV con
  fórmulas neutralizadas por tipo real; nombres de fichero saneados.
- **Visor de Markdown (ADR-0011).** Lista blanca de etiquetas cerrada; `strip` de todo lo que
  embebe o ejecuta; atributos solo `title`, `style` reconstruido, `href` web en `a` y `color` en
  `font`; `img`, `form`, `input`, `link`, `meta` y `base` nunca se crean; `class`, `id`, `on*`,
  `srcset`, `data-*`, `target`, `rel`, `ping` y `download` se quitan. La marca `data-vigia-slot`
  lleva 128 bits aleatorios por sesión y solo se admite con ese valor exacto. El `style` que llega
  al DOM se genera solo desde canales numéricos, nunca de la cadena original. Los plugins visuales
  van después del saneado.
- **Enlaces externos.** Solo `MarkdownText` crea `<a href>`; `target="_blank"` lo recoge
  `setWindowOpenHandler` en main con `isSafeExternalUrl`; `file:`, `javascript:` y `app://` se
  bloquean.
- **Cuota (ADR-0004).** `MANUAL` en todas las consultas de módulo; ningún `refetchInterval` ni
  `useEffect` que llame a `refetch`; «Actualizar» acota por `[envId, módulo]`; «Reintentar» de cada
  panel repite solo su consulta (0064); `combineQueries.refetch` repite solo las fallidas.
- **Reutilización (0058).** Process group, aplicación y disco usan `useEntityPageAccess`,
  `EntityMarkers`, `EntityTables`, `EntityChartPanel`, `ProblemBand`, `EntitySections` y
  `EntityInfoCard`; los comparadores vienen de `@shared/grid-sort`.
- **CI (0056, 0072, 0073).** `permissions: contents: read`, sin secretos ni `pull_request_target`;
  cuatro acciones por SHA con comentario y test que las fija; `cancel-in-progress` solo en PR; el
  e2e no corre en el push a `main` y `dist:win` no corre en PR; artefactos solo si falla.
  `ci-changes.mjs`: `git diff --name-only -z HEAD^1 HEAD` sobre el commit de fusión es correcto;
  borrados y renombrados cuentan como código; la lista de lo que no cuenta vive en un solo sitio.
- **`scan-tenant.mjs` (0055).** Falla cerrado sin `.env`, con `.env` vacío, con un error de git y
  con una línea de stdin mal formada; nunca imprime valores. **`integrate.mjs` (0073)**: no toca git
  más que para leer; `execFileSync` sin shell; `groupForPrs` para con `exclusiones` escalar, vacío
  o desconocido.
- **Arnés de vistas (0069).** `setupViewsApp` registra ganchos por spec; `resetState` reemplaza
  todo el estado del simulador; el `afterEach` de seguridad corre también si falla el `beforeEach`;
  dos guardas (`e2e-views-harness.test.ts`, `e2e-ci-window.test.ts`) impiden saltarse el arnés.
- **Secretos en el renderer.** El valor solo vive en el `useState` de `SecretRow`, la mutación con
  `gcTime: 0`; `localStorage` solo guarda tema, idioma y barra lateral.

---

## T. Tooling, CI y cadena de publicación

### T-01. El pre-push no limita a dónde se hace push: `main`, borrados y force por refspec pasan

**Descripción.** La regla «push solo a `integra/…`, nunca `--force`, los agentes no borran ramas
remotas» (`CLAUDE.md`, "Reglas que no se saltan"; `docs/flujo.md`, "git y push") vive solo en prosa
y en los patrones de texto de `.claude/settings.json` (`deny`, líneas 29 a 50). Técnicamente:

- `.githooks/pre-push:10` solo lanza `scan-tenant --pre-push`. `scripts/scan-tenant.mjs:132-145`
  (`prePushRanges`) lee de cada línea de stdin el ref remoto y **lo descarta**: solo usa los dos
  SHA. Un `git push origin HEAD:main` o `git push origin integra/x:main` pasa el hook (con el
  escaneo en verde) y, sin la protección de `main` activa (el `CLAUDE.md` dice que aún no lo
  está), integra sin PR ni «CI ok».
- Las líneas de borrado (`local` a ceros) se omiten (`:141`) y el script sale con 0 con el mensaje
  «solo se borran ramas remotas» (`:220-224`): `git push origin :integra/20261011-1` borra la rama
  remota sin que nada lo pare.
- Un push no lineal por refspec (`git push origin +feat/x:integra/y`) no lleva `--force` en la
  línea de comandos: no lo caza ningún patrón de `deny` (solo cubren `--force`, `-f` y
  `--force-with-lease`), y el hook tampoco mira si `remote_sha` es antepasado de `local_sha`.
- `git -c core.hooksPath=/dev/null push …`, `git push --mirror` y `git push --prune` tampoco están
  en `deny` (`Bash(* --no-verify*)` sí).

**Impacto: alto.** Es la única puerta sin IA entre el Orquestador (un modelo) y el repositorio
público; hoy depende de que el agente lea bien la prosa. Cuando Dani proteja `main`, GitHub cerrará
el primer punto, pero no los borrados de `integra/` ni los pushes no lineales a `integra/`.

**Esfuerzo: pequeño.**

**Ficheros.** `scripts/scan-tenant.mjs` (o un script nuevo `scripts/check-push.mjs` que el hook
llame antes del escaneo), `scripts/scan-tenant.test.ts`, `.githooks/pre-push`,
`.claude/settings.json`, `docs/flujo.md` ("Puertas sin IA"), `README.md`.

**Relaciones.** Flujo con agentes (`tarea.md` paso 9, `cerrar-version.md` paso 4); protección de
`main` (decisión de Dani); ADR-0007 y ADR-0014; `exclusiones: [seguridad]`.

**Solución propuesta.**

1. Una función pura `checkPushRefs(lines, { allowed })` que, por línea de stdin, devuelva un
   problema si el ref remoto no casa con `^refs/heads/integra/`, si es un borrado (`local` a ceros)
   o si no es lineal (`git merge-base --is-ancestor <remote> <local>` distinto de 0 cuando `remote`
   no es ceros). El `--pre-push` sale con código **3** y un mensaje claro; el hook lo traduce («el
   destino no es una rama integra/, se borra una rama o no es lineal: no se publica»).
2. Dani puede abrir la puerta para un caso concreto con `VIGIA_PUSH_ALLOW_REFS=refs/heads/main`
   (solo valores exactos, como `VIGIA_SCAN_TENANT_OPTIONAL`), documentado en README y `flujo.md`.
3. En `settings.json`, añadir `deny` para `git push * +*`, `git push * :*`, `git push * HEAD:*`,
   `git push * --mirror*`, `git push * --prune*`, `git -c *push*` y `git push origin main` (en las
   dos variantes, Bash y PowerShell). Es la segunda capa; la primera es el hook.
4. Tests: `checkPushRefs` con las cuatro formas; CLI `--pre-push` con una línea a `refs/heads/main`
   da 3; con borrado da 3; con un repositorio temporal y un push no lineal da 3; con la variable y
   el valor exacto, pasa.

**Explicación.** Un hook de pre-push ve exactamente lo que git va a subir (ref de destino y los dos
SHA): es el sitio natural para la regla «solo `integra/`, solo hacia delante, sin borrar». Los
patrones de permisos de Claude Code miran el texto del comando, y git tiene cinco maneras de decir
lo mismo; la comprobación tiene que estar donde la forma del comando no importe. Un control que no
puede saltarse cambiando la sintaxis es un control; lo otro es una recomendación.

### T-02. «CI ok» queda en verde si `windows` se salta por una salida vacía de `cambios`

**Descripción.** `.github/workflows/ci.yml:63`: `if: needs.cambios.outputs.codigo == 'true'`. Si
la salida llega vacía (el paso `cambios` cambia de `id`, `scripts/ci-changes.mjs:65` no escribe nada
sin `GITHUB_OUTPUT`, un `appendFileSync` fallido o un `outputs` mal mapeado en el futuro), `windows`
se **salta**, y `ci-ok` (`ci.yml:121`) solo falla con `failure` o `cancelled`: `skipped` es verde.
`scripts/ci-changes.main.test.ts` («sin GITHUB_OUTPUT no escribe nada») fija justo ese
comportamiento, y `ci-workflow.test.ts` solo exige que la condición mencione `needs`, `failure` y
`cancelled`.

**Impacto: medio.** Hoy el `id` es correcto y GitHub siempre define `GITHUB_OUTPUT`; pero el check
que exigirá la protección de `main` tiene un camino en el que «no se ha probado nada» se lee como
«todo bien». Un control de este tipo tiene que fallar cerrado.

**Esfuerzo: pequeño.**

**Ficheros.** `.github/workflows/ci.yml`, `scripts/ci-changes.mjs`, `scripts/ci-changes.main.test.ts`,
`scripts/ci-workflow.test.ts`.

**Relaciones.** Protección de `main`; fichas 0072 y 0073; `groupForPrs` (las PR agrupadas las
fusiona el Orquestador con «CI ok» en verde); T-03.

**Solución propuesta.** (1) `windows`: `if: needs.cambios.outputs.codigo != 'false'` (lo desconocido
prueba). (2) `ci-ok`: además de `failure` y `cancelled`, rojo si
`needs.cambios.outputs.codigo != 'false' && needs.windows.result != 'success'`, y el `echo` final
imprime también `codigo`. (3) `ci-changes.mjs`: si `GITHUB_ACTIONS` está definido y falta
`GITHUB_OUTPUT`, lanzar (fuera del CI se mantiene el comportamiento actual). (4) Tests: en
`ci-workflow.test.ts`, que el `if` de `windows` no sea una igualdad con `'true'` y que la condición
de `ci-ok` nombre `codigo` y `success`; en `ci-changes.main.test.ts`, el caso `GITHUB_ACTIONS=true`
sin `GITHUB_OUTPUT` lanza.

**Explicación.** `skipped` significa «no hacía falta» solo cuando alguien lo ha decidido
explícitamente; cuando la decisión no llega, el valor por defecto tiene que ser «hace falta».
Comparar con `'true'` convierte el silencio en luz verde.

### T-03. La fusión por `gh pr merge` no va atada al commit que pasó el CI, y `[skip ci]` deja la PR sin check

**Descripción.** `.claude/commands/tarea.md:133-135` y `cerrar-version.md:31`: se sondea
`gh pr checks <n>` y, con «CI ok» en verde, `gh pr merge <n> --merge`. No hay `--match-head-commit`
en ningún sitio (`grep` vacío en `.claude/` y `docs/flujo.md`). Entre la lectura de los checks y
la fusión, la `integra/…` puede recibir un push nuevo (el merge de `origin/main` por conflictos,
`tarea.md:50-54`, o el `fix(…)` de una `fix/NNNN-ci`): se fusionaría un head cuyo CI no ha
terminado. Además, `docs/adr/0013-carril-rapido-y-menos-repeticiones.md:93` sigue diciendo que un
commit de medición con código «lleva `[skip ci]`»: GitHub no lanza el workflow de `pull_request` si
el **head commit** de la PR lleva `[skip ci]`, así que esa PR no tendría ningún check «CI ok» (ni
verde ni rojo). Se escribió antes de la 0073 y hoy contradice el flujo.

**Impacto: medio.** Ventana pequeña pero real, y el texto del ADR es una instrucción que un agente
puede seguir al pie de la letra.

**Esfuerzo: pequeño.**

**Ficheros.** `.claude/commands/tarea.md`, `.claude/commands/cerrar-version.md`, `docs/flujo.md`
("PR agrupada"), ADR-0013, `scripts/integration-docs.test.ts`.

**Relaciones.** T-02; protección de `main` (Dani); medición del flujo (`medir: sí`).

**Solución propuesta.** (1) En los dos comandos: `gh pr merge <n> --merge --match-head-commit <sha>`
con el SHA que pasó «CI ok» (`gh pr view <n> --json headRefOid`), y comprobar el verde con
`gh pr checks <n> --json name,state` filtrando `name == "CI ok"` en vez de leer texto. (2) ADR-0013:
sustituir la frase de `[skip ci]` por «la medición va en el commit de documentación; si tiene que ir
con código, va en su PR y pasa el CI». (3) Test en `integration-docs.test.ts`: los dos comandos
llevan `--match-head-commit`; ningún fichero de `.claude/`, `docs/flujo.md` ni los ADR vigentes
menciona `[skip ci]`. (4) Para Dani, al activar la protección: «Require status checks» con «CI ok»
y «Require branches to be up to date».

**Explicación.** «Fusiona si el CI está en verde» tiene que referirse a un commit concreto, no a «la
rama». `--match-head-commit` convierte la condición en atómica: si la rama se movió, GitHub rechaza
la fusión y se vuelve a mirar.

### T-04. `affected-e2e.cjs` lanza Playwright con `shell: true` sin citar los argumentos

**Descripción.** `scripts/affected-e2e.cjs:148-151`:

```js
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  return result.status ?? 1
}
```

Con `shell`, Node concatena `args` con espacios **sin escapar** y se lo pasa a `cmd.exe /c`. El
patrón de `-g` viene del usuario (`parseArgs`, `:102-106`): `-g "CA3 (0012)"` llega a Playwright
como `-g CA3` más un spec `(0012)` («no tests found»); un patrón con `&`, `|`, `>`, `^` o `%VAR%` lo
interpreta cmd. Lo mismo con una ruta de spec con espacios. `docs/flujo.md` y `developer.md`
recomiendan justo `-g "(NNNN)"`, que hoy funciona porque no lleva espacios. Los tests de
`affected-e2e.test.ts` cubren `plan` (la lista de argumentos), no cómo se ejecuta.

**Impacto: medio.** Corrección (el filtro silenciosamente no filtra, o falla) y una inyección de
shell con entrada propia. El `shell: true` existe porque `npx` en Windows es `npx.cmd` y Node 22 no
lo lanza sin shell (CVE-2024-27980).

**Esfuerzo: pequeño.**

**Ficheros.** `scripts/affected-e2e.cjs`, `scripts/affected-e2e.test.ts`.

**Relaciones.** developer y verifier (ADR-0013); `npm run test:e2e:affected`; ficha 0071 (que
añadirá más opciones al script).

**Solución propuesta.** Sin shell: ejecutar los CLI con `process.execPath` y el fichero `.js`
resuelto (`require.resolve('playwright/cli')`, `require.resolve('electron-vite/bin/electron-vite.js')`
o `node_modules/.bin/*` resuelto a su `.js`), con `args` en array. `plan` devuelve ya
`{ command: process.execPath, args: [cli, 'test', ...] }` y `run` no usa `shell`. Tests: `plan` con
`-g 'CA3 (0012)'` da un único argumento con el espacio; un test que lanza `run` con un script de
Node simulado que imprime `process.argv` y comprueba que `(0012)`, `a&b` y una ruta con espacio
llegan tal cual.

**Explicación.** Con `shell: true`, la frontera entre argumentos la decide cmd.exe, no Node: cada
espacio o metacarácter cambia el significado. Resolver el fichero `.js` del CLI y lanzarlo con
`node` evita el `.cmd` y, con él, la shell.

### T-05. `scan:tenant` no mira ficheros binarios, nombres de fichero ni renombrados

**Descripción.** `scripts/scan-tenant.mjs:97-113` escanea solo las líneas `+` de
`git diff --unified=0`. Para un binario (`.gitattributes` marca `*.png` y `*.ico`; también `.xlsx`,
`.zip`, `.db` o una captura de pantalla con la URL del tenant en la barra de direcciones) git
imprime «Binary files … differ» y no hay líneas que mirar. Las líneas `+++ b/…` se usan solo para
apuntar el fichero (`:98-100`) y nunca se comparan con las agujas: un fichero nuevo llamado
`docs/img/<id-de-entorno>.png` o `src/test/fixtures/<host>.json` pasa. Los `rename from/to`
también. `scan-tenant.test.ts` no tiene ningún caso de binarios ni de nombres. Hoy el repositorio
solo tiene `build/icon.{ico,png}`.

**Impacto: medio.** Es la regla «nada del tenant en el repositorio» y hay un camino en blanco; la
probabilidad crece con las capturas que piden las fichas de interfaz.

**Esfuerzo: pequeño.**

**Ficheros.** `scripts/scan-tenant.mjs`, `scripts/scan-tenant.test.ts`, `docs/flujo.md`, `README.md`.

**Relaciones.** Pre-push; `notify-telegram` (comparte `extractNeedles`); `.gitattributes`; T-01
(misma ficha si se quiere).

**Solución propuesta.** (1) `git diff --name-status -z <rango>` para comparar cada ruta (y el
destino de un `R`) con las agujas, con un tipo de hallazgo `fichero (nombre)`. (2) Para cada fichero
añadido o modificado que `git diff --numstat` marque como binario (`-\t-`), leer
`git show <local>:<ruta>` y buscar las agujas en el contenido como `latin1` y como UTF-16LE (los
xlsx son zip: no se ven; se documenta). (3) Opción más simple y más dura: un binario nuevo fuera de
`build/**` hace fallar con 2 salvo `VIGIA_SCAN_ALLOW_BINARY=1`, y el mensaje lo dice. Tests: un
repositorio temporal con un `.png` cuyo nombre lleva el host de prueba da 1; un `.bin` cuyo
contenido lleva el token da 1 (o 2 con la opción 3); un renombrado hacia un nombre con el id da 1.

**Explicación.** El escaneo mira «lo que git muestra como texto»; el tenant puede viajar en
cualquier byte y en el propio nombre. Lo que no se puede leer se trata como sospechoso o se lee de
otra forma, pero no se ignora.

### T-06. `integrate.mjs` solo se fía de `estado: verificada` y del nombre de la rama

**Descripción.** `scripts/integrate.mjs:70-84` (`checkIntegration`) comprueba `estado`, árbol limpio
y `branch === ficha.rama`. No comprueba: (a) que la última ronda de «Notas del revisor» sea APROBADO
y que «Verificación» diga VERDE (el flujo lo exige), es decir, que `verificada` lo escribió un
proceso y no un olvido; (b) que `ficha.id` coincida con el `NNNN` del nombre del fichero y de
`rama` (`feat/0074-x` con `id: '0075'` produce un commit `(#0075)` sobre la rama de otra ficha);
(c) que la rama contiene la base (`git merge-base --is-ancestor <base> HEAD`): si la `integra/…`
avanzó, el `merge --squash` del Orquestador se hará contra una base distinta de la que vio el
verifier. Además `parseFrontMatter` (`:39-57`): el bloque termina en el primer `\n---` aunque sea
`--- texto` dentro de un valor; un BOM hace que todo el front matter sea `{}` (falla cerrado, pero
con el mensaje «(sin estado)», que despista); y `cleanScalar` (`:30`) corta un título que contenga
` #` («Métricas #2»). `buildCommitMessage` (`:60-63`) escribe `undefined` si falta `titulo` o `id`.

**Impacto: medio.** Defensa en profundidad sobre el paso que decide qué entra en `main`; lo demás,
robustez.

**Esfuerzo: pequeño.**

**Ficheros.** `scripts/integrate.mjs`, `scripts/integrate.test.ts`, `scripts/integrate.main.test.ts`,
`.claude/commands/tarea.md` (pasar `--base` al script).

**Relaciones.** Flujo (reviewer, verifier, Orquestador), ADR-0014.

**Solución propuesta.** `node scripts/integrate.mjs <ficha> <zona> --base <base>`; `checkIntegration`
recibe además `{ approved, verifierGreen, isAncestor, fileId, branchId }` calculados por `main`
(regex sobre las secciones «Notas del revisor» y «Verificación»; `git merge-base --is-ancestor`) y
añade un motivo por cada fallo; `id` y `titulo` obligatorios. `parseFrontMatter`: quitar BOM, exigir
`^---$` como cierre y tratar ` #` como comentario solo fuera de comillas (o documentar en la
plantilla que el título va entre comillas si lleva `#`). Tests para cada motivo nuevo y para los
tres casos del parser.

**Explicación.** El script existe para que la parte comprobable de integrar no dependa de la
memoria del agente; cuanto más de lo que dice el flujo esté en el script, menos vale un
`estado: verificada` escrito a mano.

### T-07. `notify-telegram` envía igualmente cuando no puede filtrar el tenant

**Descripción.** `scripts/notify-telegram.mjs:202-206`: sin `.env.live.local` (ni en el cwd ni en el
checkout principal) o con uno sin valores, avisa («no se ha podido filtrar el texto; se envía
igualmente») y **envía**. Es el mismo caso que la 0055 cerró en `scan:tenant` (S-01), pero hacia un
servicio externo. El test CA8 (0004) fija ese comportamiento, y `docs/flujo.md` solo describe el
caso en que sí encuentra algo.

**Impacto: bajo-medio.** El canal es privado (bot y chat de Dani) y el texto lo redacta el
Orquestador sin datos del tenant; pero es el único filtro automático y falla abierto.

**Esfuerzo: pequeño.**

**Ficheros.** `scripts/notify-telegram.mjs`, `scripts/notify-telegram.test.ts`, `docs/flujo.md`,
`README.md`.

**Relaciones.** ADR-0009 («nunca para el flujo»: se mantiene, sigue saliendo con 0); `findLiveEnv`.

**Solución propuesta.** Sin agujas, no enviar (`[aviso telegram] sin .env con valores: no se envía`),
salvo `VIGIA_TELEGRAM_UNFILTERED=1`. Sigue devolviendo 0. Cambiar el test CA8 y añadir el de la
variable.

**Explicación.** Un filtro que, cuando no puede filtrar, deja pasar, no es un filtro: es un aviso.
Lo coherente con la 0055 es que «no he podido comprobar» tenga el mismo resultado que «he
encontrado algo», y que la excepción sea explícita.

### T-08. El pre-commit no ve los borrados y parte las rutas con espacios

**Descripción.** `.githooks/pre-commit:5`: `--diff-filter=ACMR` excluye `D`. Un commit que solo
borra `src/main/x.ts` deja `files` vacío y sale con 0 (`:6`) sin lint ni `typecheck`: lo que lo
importaba se rompe y se ve en el CI, no en el hook. `$files`, `$lintable` y `$related` van sin
comillas a propósito (`:28`, `:38`, `:46`, con `shellcheck disable`), así que una ruta con espacio
se parte en dos. Distinto de M-06 (`typecheck` de e2e e índice frente a disco), que sigue abierto.

**Impacto: bajo-medio.** El CI lo caza; cuesta una vuelta.

**Esfuerzo: pequeño.**

**Ficheros.** `.githooks/pre-commit`; un test nuevo `scripts/hooks.test.ts`.

**Relaciones.** Flujo (developer), CI; M-06 (misma ficha).

**Solución propuesta.** Dos listas: `changed` con `--diff-filter=ACMRD` para decidir si hay código
(y entonces `lint` + `typecheck` completos) y `present` con `ACMR` para Prettier, ESLint y
`vitest related`. Rutas con `-z` y `xargs -0`. Test en Vitest que crea un repositorio temporal con
`core.hooksPath`, borra un `.ts` importado por otro y comprueba que `git commit` falla por
`typecheck`.

**Explicación.** Borrar también es cambiar código: los tipos del resto del proyecto dependen de lo
que ya no está.

### T-09. `e2e-tags.cjs` no ve los tests cuyo título no es un literal

**Descripción.** `scripts/e2e-tags.cjs:26-40` (`callKind`): solo cuenta como test una llamada cuyo
primer argumento es un literal o plantilla (`isTitle`, `:52-58`) y cuya cadena es
`test`/`test.<modificador>`. Un `test(title, fn)` con `title` en una variable (bucles con tablas de
casos), un alias (`const it = test`) o `test.describe.serial.only(…)` (cadena de cuatro, `:38-39`
devuelve `null`) no se visitan como test: sus etiquetas no se comprueban y la zona no cuenta como
usada. La guarda falla **abierta** para esas formas. **Confirmado por lectura del revisor de
tooling; no contrastado línea a línea en esta pasada.**

**Impacto: bajo.** Hoy todos los specs usan literales; es la única guarda de la selección por zona
(0067), y la 0071 la hará decisiva.

**Esfuerzo: pequeño.**

**Ficheros.** `scripts/e2e-tags.cjs`, `scripts/e2e-tags.test.ts`, `e2e/CLAUDE.md`.

**Relaciones.** `npm run test:e2e:nobuild -- --grep @zona`; fichas 0067, 0070 y 0071.

**Solución propuesta.** Un problema nuevo `titulo-no-literal` para toda llamada cuya cadena empiece
por `test` (o `test.describe…`) con un primer argumento que no sea literal: el autor lo reescribe o
lo etiqueta en el `describe`. Tratar `test.describe.<mod>.<mod>` como describe. Documentar en
`e2e/CLAUDE.md`. Tests con los tres casos.

**Explicación.** Un analizador estático que «no entiende» una forma tiene que decirlo, no asumir
que está bien; si no, la lista de zonas se vuelve mentira sin que nadie lo note.

### T-10. El parser del `.env` está tres veces y `test:live` solo mira el cwd

**Descripción.** `scripts/scan-tenant.mjs:31-65` (`extractNeedles`) y `src/test/live-env.ts:16-32`
(`readLiveValues`) repiten la lectura línea a línea (`#`, `=`, comillas); `LIVE_ENV_FILE` está en
`scripts/lib/env-file.mjs:8` y en `src/test/live-env.ts:12`. `live-env.ts` resuelve solo `cwd`:
desde un worktree de Orca, `npm run test:live` avisa (`live-setup.ts`) y pasa con 0 tests
(`passWithNoTests: true`, `vitest.live.config.ts:17`), sin usar el `.env` del checkout principal
que `findLiveEnv` ya sabe encontrar.

**Impacto: bajo.** Mantenibilidad; y un `test:live` que «pasa» sin credenciales confunde al
Planificador que lo lanza desde un worktree.

**Esfuerzo: pequeño.**

**Ficheros.** `scripts/lib/env-file.mjs`, `src/test/live-env.ts`, `src/test/live-setup.ts`, tests
de ambos.

**Solución propuesta.** Mover a `env-file.mjs` un `parseEnvLines(text): Map<string, string>` y que
`extractNeedles` y `readLiveValues` lo usen; `loadLiveEnv` usa `findLiveEnv(cwd)`; `live-setup`
distingue «no hay fichero» de «faltan valores». Tests: `parseEnvLines` con comentarios, comillas y
CRLF; `loadLiveEnv` desde un worktree simulado encuentra el del principal.

**Explicación.** Tres copias del mismo parser divergen la primera vez que una cambia; una sola, con
test, mantiene iguales el filtro del tenant y las pruebas en vivo.

### T-11. `execFileSync` sin `timeout` ni `maxBuffer` en tres scripts; `--relative` en `affected-e2e`

**Descripción.** `scripts/scan-tenant.mjs:68` tiene `maxBuffer` (512 MB) pero ningún `timeout`;
`scripts/integrate.mjs:127`, `scripts/affected-e2e.cjs:142` y `scripts/ci-changes.mjs:49` van con el
`maxBuffer` por defecto de Node (1 MiB): un `git diff --name-only` de un rango muy grande lanza
`ENOBUFS` y el script muere con una traza (cerrado, pero ilegible). `affected-e2e.cjs:161` usa
`--relative`: lanzado desde una subcarpeta, las rutas no casan con `areas.json` y todo cae en «sin
área», es decir, el e2e completo (seguro, pero sorprendente).

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** Los cuatro scripts; nuevo `scripts/lib/git.mjs`.

**Solución propuesta.** Un helper `git(args, { cwd })` en `scripts/lib/git.mjs` con `maxBuffer` de
64 MiB, `timeout: 60_000`, `windowsHide` y un error con mensaje corto; `affected-e2e` ejecuta git
con `cwd` en la raíz (`join(__dirname, '..')`) y sin `--relative`. Test del helper con un comando
que excede el buffer.

**Explicación.** Cuatro scripts, cuatro maneras de llamar a git; lo que falle en uno se arregla en
uno. Un helper único es también donde poner mañana `--no-pager` o `GIT_TERMINAL_PROMPT=0`.

### T-12. Cobertura: `scripts/**` y `src/preload/**` quedan fuera del umbral

**Descripción.** `vitest.config.ts:16`: `coverage.include` solo `src/main/**` y `src/shared/**`. Los
`.mjs` y `.cjs` de `scripts/` (integración, CI, escaneo del tenant, aviso) tienen tests, pero
ninguna rama nueva sin test baja el umbral; `src/preload/**` tampoco cuenta.

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** `vitest.config.ts`.

**Solución propuesta.** Añadir `scripts/**/*.{mjs,cjs}` y `src/preload/**/*.ts` al `include` (v8
cubre JS), medir y fijar sus umbrales como se hizo el 2026-10-04 (`thresholds.perFile` para
`scripts/` si hace falta). Lo comprueba el propio `check`.

**Explicación.** El umbral avisa de lo que se queda sin test; si la cadena de publicación no está en
él, es justo ahí donde nadie avisa.

### T-13. Documentación que ya no cuadra con los scripts

**Descripción.**

- `README.md:51`: «El pre-push (`npm run scan:tenant`)»; el hook ejecuta
  `node scripts/scan-tenant.mjs --pre-push` precisamente para no necesitar `node_modules`
  (`.githooks/pre-push:4,10`); `npm run scan:tenant` sin `--pre-push` escanea `origin/main..HEAD`.
- `.claude/agents/verifier.md:3` («hasta que existan las etiquetas por zona») y `docs/flujo.md`: las
  etiquetas existen desde la 0067; lo pendiente es que `test:e2e:affected` las use (0071).
- ADR-0013, línea 93: `[skip ci]` (ver T-03).
- `.gitignore:18` ignora `docs/auditorias/` pero no `docs/revisiones/` (esta carpeta aparece como
  `??` en `git status`): o se versionan los informes (pasan por `scan:tenant`, no llevan datos del
  tenant) o se ignoran como la otra. Hoy depende de que nadie haga `git add -A`. Es decisión de
  Dani; versionarlos es coherente con «el repositorio es la única memoria».
- `src/main/CLAUDE.md`, regla de la 0060: dice que «cliente y SSO» dan `redirectRefused`; el SSO da
  `ssoUnreachable` (ver P-08).

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** `README.md`, `.claude/agents/verifier.md`, `docs/flujo.md`, `.gitignore`, ADR-0013,
`src/main/CLAUDE.md`. Test: ampliar `scripts/integration-docs.test.ts` con las frases nuevas.

**Explicación.** Para los agentes el repositorio es la única memoria: una frase vieja en un `.md`
es una instrucción vigente.

---

## P. Proceso principal (main)

### P-01. Varios 401 a la vez con OAuth disparan N renovaciones y tiran un token recién renovado

**Descripción.** `src/main/dynatrace/client.ts:383-388`: ante un 401 con OAuth, cada petición llama
a `deps.oauth.invalidate(envId)` y después a `authorization(envId, api, 'oauth')`.
`src/main/dynatrace/oauth.ts:249-253`:

```ts
invalidate(envId) {
  tokens.delete(envId)
  pending.delete(envId)
  generation.set(envId, (generation.get(envId) ?? 0) + 1)
}
```

`pending.delete` borra del mapa la renovación en curso, y `getToken` (`oauth.ts:233-246`) solo
comparte la renovación si está en `pending`. Con el limitador hay hasta 6 peticiones en vuelo por
entorno; si el token deja de valer (revocado, secreto rotado, desfase de reloj mayor que el margen
de 60 s), las 6 reciben 401 casi a la vez: A invalida y lanza la renovación P1; B invalida (borra P1
de `pending`, sube la generación) y lanza P2; y así hasta P6. Seis `POST` al SSO con el mismo
`client_secret`, y por la guarda de generación (`oauth.ts:239`) solo se guarda el último. Peor: si A
ya ha renovado y guardado un token nuevo y el 401 de B (hecho con el token viejo) llega después, B
invalida el token **nuevo** y vuelve a pedir. `invalidate` no sabe qué token falló. Además, la
renovación se hace dentro del `try` que ocupa el sitio del limitador (`client.ts:359-371`): el
`POST` al SSO (hasta 30 s) se hace ocupando uno de los 6 sitios de Dynatrace.

**Impacto: medio.** Con un secreto rotado, cada vista con 6 consultas pega 6 veces al SSO con
credenciales malas (un SSO con límite o bloqueo por intentos lo nota), y con desfase de reloj se
descartan tokens válidos. No es inseguro; es gasto y una regla rota: el comentario de `oauth.ts:110`
(«las peticiones simultáneas comparten una única renovación») solo se cumple si nadie llama a
`invalidate` entre medias.

**Esfuerzo: pequeño.**

**Ficheros.** `src/main/dynatrace/oauth.ts`, `src/main/dynatrace/client.ts`, `oauth.test.ts`,
`client.test.ts`, `src/main/dynatrace/services.ts` (la fachada `oauth.invalidate`).

**Relaciones.** Todos los canales de plataforma con OAuth; `connection:test`;
`onEnvironmentChanged` (`services.ts:99-104`), que debe seguir invalidando sin condición. P-06
(misma ficha: cancelar el cuerpo del 401).

**Solución propuesta.** (1) `invalidate(envId, staleToken?)`: si se pasa `staleToken` y el cacheado
(`tokens.get(envId)?.accessToken`) ya es otro, no hacer nada; en ningún caso borrar `pending` (una
renovación en curso es justo lo que los demás deben esperar); la generación solo sube cuando se
invalida de verdad. `onEnvironmentChanged` sigue llamando sin token (invalidación total). (2) En
`client.ts`, `authorization` devuelve también el `accessToken` usado y el 401 llama a
`invalidate(envId, token)`. (3) Sacar la renovación fuera del sitio: que `handleResponse` devuelva
`{ retry: true, wait: 0, renew: true }` y el bucle renueve después del `finally` (igual que el 429
duerme fuera), cancelando `response.body` como en el 429. Tests: en `oauth.test.ts`, «tres 401
simultáneos con el mismo token: una sola petición al SSO y los tres reciben el mismo token»;
«`invalidate` con un token que ya no es el cacheado no pide otro»; en `client.test.ts`, el test de
la línea 262 pasa a esperar `invalidate(ENV, 'oauth-access-1')`, y uno nuevo con `fetchFor` que
cuente en vuelo: durante la renovación no hay sitio ocupado.

**Explicación.** Invalidar una caché «a ciegas» (sin decir qué entrada se cree mala) convierte un
fallo de una petición en un fallo para todas: la segunda tira lo que la primera acaba de arreglar.
El patrón es comparar y borrar («si lo que hay es lo que me falló, bórralo») y dejar que todos
esperen la misma renovación.

### P-02. El log de main escribe el nombre de usuario de Windows en las rutas; el del renderer no

**Descripción.** `src/main/db/backup.ts:81`, `:118` y `:126` registran la ruta completa de la copia
(`%APPDATA%\vigia\backups\…`, es decir `C:\Users\<nombre>\AppData\Roaming\…`).
`src/main/ipc/handler.ts:75` y `errorHandler.startCatching` (`logging.ts:25`) escriben pilas de
error con rutas del asar (el zip es portable: `C:\Users\<nombre>\…\resources\app.asar\…`). El
proyecto ya decidió que el nombre de usuario en rutas es dato sensible:
`src/shared/error-report.ts:43-55` (`maskErrorDetails`) lo sustituye por `<usuario>` para los
errores del renderer (`app.ts`), pero el hook final `maskLogMessage` (`src/main/log-mask.ts:17-29`)
solo aplica `maskSecrets` (tokens y cabeceras). `logging.ts:10-11` dice que el log existe «para
poder depurar en equipos ajenos»: es un fichero pensado para enviarse.

**Impacto: bajo-medio.** No es una credencial, pero es exactamente el dato que el proyecto ya
enmascara en la otra mitad del log; hoy la regla se cumple a medias según quién escriba la línea.

**Esfuerzo: pequeño.**

**Ficheros.** `src/main/log-mask.ts`, `log-mask.test.ts`; `src/main/db/backup.ts` (registrar
`basename`); `src/main/CLAUDE.md` (regla de la 0060).

**Relaciones.** Todo lo que escribe en `log`; `app:logRendererError` (sigue enmascarando antes).

**Solución propuesta.** En `maskValue`, usar `maskErrorDetails` (de `@shared/error-report`, ya
importable desde main como hace `app.ts`) en vez de `maskSecrets` para cadenas, `message` y
`stack`. En `backup.ts`, registrar `basename(destination)` (la carpeta es conocida). Test: un
`Error` cuya pila contiene `C:\Users\dani\…` sale como `C:\Users\<usuario>\…`; una ruta `/home/x/…`
igual.

**Explicación.** Un filtro «de última barrera» tiene que cubrir las mismas categorías que las
barreras locales; si no, basta con que una línea nueva no pase por la local para que se cuele.

### P-03. `maskLogMessage` solo mira el primer nivel: arrays, objetos anidados y `cause` pasan sin enmascarar

**Descripción.** `src/main/log-mask.ts:17-29`: una cadena o un `Error` se enmascaran; un objeto
plano, solo sus valores de texto directos (`:24`); cualquier array, objeto anidado, `Map` o clase
que no sea `Error` ni objeto plano se devuelve tal cual (`:28`). En `maskError` (`:32-49`) se copian
todos los descriptores propios, `cause` incluido, sin enmascarar (`log-mask.test.ts` lo exige:
`copy.cause` es el mismo objeto). Hoy ninguna llamada de main registra arrays ni objetos anidados
(comprobado), pero el hook existe precisamente para la línea que nadie revisó: un `Error` de
undici o de Electron con `cause` (como el propio `TypeError('fetch failed', { cause })`), o un
`logger.error('…', { response: { headers } })` futuro. **No verificado** (sin `node_modules`) si
el formateador de electron-log escribe `cause`; el hueco de arrays y anidados sí es real. Ya está
anotado en el BACKLOG como `[ALCANCE]` de la 0060, pendiente de Dani.

**Impacto: bajo-medio.** Hoy no hay fuga; es la robustez del mecanismo que el proyecto llama
«última barrera».

**Esfuerzo: pequeño.**

**Ficheros.** `src/main/log-mask.ts`, `log-mask.test.ts`, `src/main/CLAUDE.md` (quitar «solo el
primer nivel»).

**Solución propuesta.** `maskValue(value, depth)` recursivo con tope de profundidad (4, como
`entity-secrets.ts`) y guarda contra ciclos (`WeakSet`): arrays elemento a elemento; objetos planos
valor a valor; en `maskError`, enmascarar `cause` si es `Error` o cadena. Tests: `['Api-Token x']`
sale como `['Api-Token ***']`; `{ a: { b: 'dt0c01.P.S' } }` con la parte secreta oculta;
`new Error('x', { cause: new Error('Bearer t') })` con la causa enmascarada; un objeto cíclico no
cuelga.

**Explicación.** Un filtro que no baja niveles protege contra el formato que esperas, no contra el
que te llega. El coste de recorrer con tope es despreciable para el volumen de log de Vigía.

### P-04. Dos criterios distintos para reenvolver un rechazo de Dynatrace con `reason`

**Descripción.** `src/main/ipc/handlers/metrics-query.ts:48-56` (`rethrowRejected`, ficha 0057) solo
reenvuelve `BAD_REQUEST` y `NOT_FOUND`. Cinco handlers de `modules.ts` siguen con un `catch` propio,
copiado, con **otro** criterio: `error.reason === undefined && error.status !== undefined`
(cualquier estado, también 403 y 5xx): `problemCounts` (`:286-305`), `problems` (`:339`), `names`
(`:392`), `hostLogs` (`:699`) y `hostEvents` (`:743`). Consecuencia visible: un 403 por falta de
`metrics.read` en `entities:hostMetrics` llega a la interfaz como `FORBIDDEN` sin `reason` (texto
genérico del código), y el mismo 403 por falta de `entities.read` en `entities:hostLogs` llega con
`hostLogsRejected` y el texto de Dynatrace como detalle. Y un `INVALID_RESPONSE` con `reason`
(`notJson`) nunca se reenvuelve en el segundo grupo, pero un `SERVER_ERROR` sí. M-01 unificó los
seis de métricas; esto es lo que quedó fuera, con un criterio distinto.

**Impacto: bajo-medio.** Mantenibilidad: dos reglas para «cuándo le pongo motivo del canal a un
rechazo», en diez sitios, y un test de regresión por sitio. El usuario ve mensajes de distinta
naturaleza para el mismo 403 según la tarjeta.

**Esfuerzo: pequeño-medio** (cinco handlers y sus tests; el contrato IPC no cambia).

**Ficheros.** `src/main/ipc/handlers/metrics-query.ts`, `modules.ts`, los tests
`entity-problems.test.ts`, `entity-problem-list.test.ts`, `host-logs.test.ts`,
`host-events.test.ts`, `modules.test.ts`.

**Relaciones.** Canales `entities:problemCounts`, `entities:problems`, `entities:names`,
`entities:hostLogs`, `entities:hostEvents`; `src/main/error-reasons.test.ts` (lista blanca de
`DtError` sin `reason`); textos `errorReasons.*` en es/en.

**Solución propuesta.** Decidir un solo criterio y escribirlo en `rethrowRejected`: por ejemplo
«todo `DtError` con `status` y sin `reason`» (lo que hacen los cinco), con un parámetro `statuses?`
solo si alguien necesita acotarlo. Sustituir los cinco `catch` por `rethrowRejected(error, '<key>')`
y añadir en `metric-series-guard.test.ts` (o un test hermano) una guarda que falle si en
`modules.ts` aparece el patrón `error.reason === undefined && error.status !== undefined` fuera del
helper. Test del helper: 403 y 500 sin `reason` se reenvuelven; `INVALID_RESPONSE` con `reason` no.

**Explicación.** Cuando dos trozos de código deciden lo mismo con reglas distintas, la diferencia no
es una decisión: es un accidente que se vuelve comportamiento. La 0057 creó el sitio donde poner la
regla; conviene que viva solo ahí.

### P-05. Las etiquetas de hoja del XLSX no pasan por `sheetNameSchema`

**Descripción.** `src/shared/ipc.ts:68-74` define `sheetNameSchema` (1 a 31 caracteres, sin
`[]:*?/\`, sin apóstrofo en los bordes, no «History») y lo aplica a las hojas de `export:workbook`
(`:82`), comprobando incluso la colisión con el nombre de la hoja Info. Pero
`xlsxLabelsSchema.dataSheet` e `infoSheet` (`src/shared/modules.ts:965-966`) son
`z.string().min(1).max(60)`, y son nombres de hoja: `xlsx.ts:144` usa `labels.dataSheet` como
nombre de la hoja de datos y `:173` hace `addWorksheet(labels.infoSheet)`. `partSheetName` solo
recorta a 31; no quita caracteres. Un `dataSheet` con `/` o de más de 31 caracteres: ExcelJS
(**no verificado** sin `node_modules`) lanza por los caracteres y avisa por la longitud; el usuario
recibiría `INTERNAL` sin `reason`. Hoy los valores salen de `locales/*.json`, así que no ocurre;
pero es main quien no se fía del renderer (`csv.ts:18-20`), y aquí sí se fía.

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** `src/shared/modules.ts`, `src/shared/ipc.ts` (mover `sheetNameSchema` a `modules.ts`
o importarlo), `src/main/export/xlsx.test.ts`, `src/shared/ipc.test.ts`.

**Relaciones.** `export:table`, `export:workbook`; `locales` (las etiquetas actuales, «Datos»,
«Data» e «Info», cumplen). `exclusiones: [ipc]`.

**Solución propuesta.** `dataSheet: sheetNameSchema, infoSheet: sheetNameSchema` en
`xlsxLabelsSchema`; el `refine` de colisión ya existe. Test: un `xlsxLabels.dataSheet` de 32
caracteres o con `/` falla en el contrato con `INVALID_INPUT`.

**Explicación.** Si una regla de validación existe para un campo, los otros campos que acaban en el
mismo sitio (un nombre de hoja de Excel) deben pasar por ella; si no, el límite se aplica donde
alguien se acordó.

### P-06. Cancelación a medias en el cliente: la espera del 429 no se puede abortar y el 401 no cancela el cuerpo

**Descripción.** `src/main/dynatrace/client.ts:373`: `await deps.sleep(outcome.wait)` espera hasta
60 s (`MAX_WAIT_MS`) sin mirar la señal; la cancelación solo se nota en el siguiente `acquire`
(`:351`). Una petición cancelada en mitad del `Retry-After` queda viva hasta un minuto y después
rechaza. Y el 401 con renovación (`:383-389`) devuelve `retry` sin cancelar `response.body`,
mientras el 429 sí lo hace (`:417`). Lo segundo ya está en el BACKLOG («Cancelar el cuerpo del 401
de OAuth antes de reintentar», de la 0062); lo primero no. Ningún handler pasa `signal` todavía
(también anotado), así que hoy nada lo sufre.

**Impacto: bajo.** Preparación para cuando los handlers pasen `signal`.

**Esfuerzo: pequeño.**

**Ficheros.** `src/main/dynatrace/client.ts`, `src/main/dynatrace/services.ts:92` (`sleep`
inyectado), `client.test.ts`.

**Relaciones.** P-01 (misma ficha); el reintento del 429.

**Solución propuesta.** `sleep(ms, signal?)`: en `services.ts`, `setTimeout` de
`node:timers/promises` acepta `{ signal }` y rechaza con `AbortError`; en `client.ts`,
`await deps.sleep(outcome.wait, cancel)` dentro de un `try` que traduzca a `cancelReason(cancel)`.
Cancelar el cuerpo del 401 como en el 429. Tests: con un `sleep` que observa la señal, abortar
durante el reintento rechaza enseguida con el `reason` de la señal y no vuelve a llamar a
`fetchFor`; el 401 renovado cancela `response.body`.

**Explicación.** Una cancelación tiene que cortar cada punto donde la operación puede estar
esperando; si uno no la mira, el usuario ve que «cancela» y el proceso sigue gastando.

### P-07. Errores tragados sin rastro: `environmentOf` y `processGroupTotal`

**Descripción.** `src/main/dynatrace/client.ts:164-177`: cualquier excepción de
`deps.getEnvironment` (en producción, una consulta a SQLite) se convierte en `NO_CREDENTIAL` «El
entorno no existe» sin escribir nada en el log. Un fallo de la base (fichero bloqueado, corrupción)
se le cuenta al usuario como «entorno inexistente» y no deja traza.
`src/main/ipc/handlers/modules.ts:177-195` (`processGroupTotal`): cualquier `DtError` (también
`TIMEOUT`, `RATE_LIMITED`, `UNAUTHORIZED`) devuelve `null` sin log; el comentario solo justifica el 403. El usuario ve «total desconocido» y nadie sabe por qué.

**Impacto: bajo.** Diagnóstico. **Esfuerzo: pequeño.**

**Ficheros.** `src/main/dynatrace/client.ts`, `src/main/ipc/handlers/modules.ts`, `client.test.ts`,
`process-group-metrics.test.ts`.

**Solución propuesta.** En `environmentOf`, dejar pasar lo que no sea «no existe»: solo convertir
`null`/`undefined`; un `DomainError('NOT_FOUND')` del repositorio ya lleva `environmentMissing`, y
cualquier otra excepción se relanza (el handler la registra como `INTERNAL`). En
`processGroupTotal`, `deps.logger.warn` con código y estado (sin selector) antes de devolver `null`,
o acotar el `null` a `FORBIDDEN`/`NOT_FOUND` y propagar el resto. Tests: `getEnvironment` que lanza
hace que el error llegue al handler y al log; un `TIMEOUT` del recuento deja una línea `warn`.

**Explicación.** Un `catch` que convierte «no sé qué ha pasado» en «no existe» borra la información
justo cuando más falta. Lo que se traga tiene que, al menos, dejar una línea.

### P-08. El 3xx del SSO da `ssoUnreachable` con texto de librería en inglés, y `src/main/CLAUDE.md` dice otra cosa

**Descripción.** `src/main/dynatrace/oauth.ts:155-182`: el rechazo por `redirect: 'error'` cae en el
`catch` genérico y sale como `NETWORK` con `reason: ssoUnreachable` y `params.detail =
error.message` («Attempted to redirect, but redirect policy was 'error'» o «fetch failed»), que la
interfaz muestra tal cual. `client.ts:137-139` exporta `isRedirectRefusal` y no se usa aquí.
`redirect.test.ts:361-363` solo comprueba el código `NETWORK`. La ficha 0060 lo decidió así a
propósito porque el texto de `redirectRefused` habla de «la URL del entorno»; pero la regla de
`src/main/CLAUDE.md` dice que «cliente y SSO» dan `redirectRefused`, que es falso para el SSO.

**Impacto: bajo.** Un comentario de reglas que contradice el código, y un detalle en inglés de una
librería delante del usuario.

**Esfuerzo: pequeño.**

**Ficheros.** `src/main/dynatrace/oauth.ts`, `redirect.test.ts`, `src/shared/error-reasons.ts` y
`locales` (si se añade `ssoRedirectRefused`), `src/main/CLAUDE.md`.

**Solución propuesta.** Un `reason` propio `ssoRedirectRefused` («La URL del SSO redirige a otra
dirección…», es/en) detectado con `isRedirectRefusal` antes del `catch` genérico, y la regla del
`CLAUDE.md` corregida. El test de `:351-367` pasa a exigir la clave.

**Explicación.** Las reglas del `CLAUDE.md` las leen los agentes como verdad; una que no coincide con
el código produce correcciones «para cumplirla» que rompen lo decidido.

### P-09. Textos en español que main manda al usuario, fuera de los locales

**Descripción.** (a) `src/main/index.ts:86`:
`dialog.showErrorBox(APP_NAME, 'No se pudo abrir la base de datos local. Revisa los logs.')` solo
en español, mientras los diálogos de la 0061 van en es/en por `crashLanguageFromLocale`
(`crash-policy.ts`); además ese diálogo es el que sale cuando falla **la copia** (`:77-82`), con la
base intacta, y el texto dice que no se pudo abrir la base. (b)
`src/main/ipc/handlers/modules.ts:440-451`: tres `warnings` en español compuestos en main («La
entidad no trae serviceType…», «serviceType X fuera de la tabla de la ficha 0046…») que llegan a la
interfaz por el campo `warnings` (pensado para los avisos de Dynatrace) y se enseñan tal cual; el
renderer ya saca su nota de los campos estructurados (`service-type.ts:33-36` lo dice: «no del texto
de warnings, que es diagnóstico y en español»), así que ese texto duplica la nota en otro idioma.

**Impacto: bajo.** Coherencia con «main no traduce» (ADR-0005). **Esfuerzo: pequeño.**

**Ficheros.** `src/main/index.ts`, `src/main/crash-policy.ts` (añadir `databaseMessage` y
`backupMessage`), `crash-policy.test.ts` (paridad es/en), `src/main/ipc/handlers/modules.ts`,
`service-metric-set.test.ts`, `src/shared/modules.ts` (si se añade un campo).

**Solución propuesta.** (a) Mover el texto a `crashTexts` con dos claves (base no abierta / copia
fallida) y elegir con `crashLanguageFromLocale`. (b) Quitar los tres `warnings` de texto o
sustituirlos por un campo estructurado en `ServiceMetricsResult` (`fallbackReason: 'noServiceType'
| 'unknownServiceType' | 'entityFailed'`) que el renderer traduce; `serviceMetricNote` ya cubre dos
de los tres casos.

**Explicación.** Cada texto en español que sale de main es un sitio donde el idioma elegido no se
respeta y donde el test de paridad es/en no llega.

### P-10. El mismo par de ayudantes `asRecord`/`asString` copiado en cinco módulos

**Descripción.** `src/main/modules/host-events.ts:54-57`, `host-logs.ts:53-56`,
`problems.ts:229-234`, `entities.ts:68-73` y `entity-secrets.ts:58-59` definen el mismo «objeto
plano o null» (y en tres de ellos el mismo `asString`), con nombres distintos (`asRecord`,
`asObject`, `isRecord`); `finite` también está copiado (`host-events.ts:111`, `problems.ts:338`).
Las fichas nuevas (0041, 0042) han seguido copiándolo.

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** Los cinco citados; nuevo `src/main/modules/raw.ts` (o en `@shared`) con test.

**Solución propuesta.** `raw.ts` con `asRecord`, `asString` y `finite` y un test de tres líneas; los
cinco módulos importan de ahí. Nada cambia en los canales.

**Explicación.** Lo pequeño repetido es lo que más cuesta ver cuando diverge (ya hay tres nombres
para lo mismo).

---

## R. Renderer y `shared`

### R-01. Números que se enseñan sin `formatNumber` (incluido el KPI de Inicio)

**Descripción.** La regla de `src/renderer/CLAUDE.md` («Todo número que se enseña pasa por
`formatNumber`», ficha 0012) se incumple en cuatro sitios:

- `src/renderer/src/pages/HomePage.tsx:110`:
  `{open.data === undefined ? '—' : (open.data.totalCount ?? open.data.problems.length)}`. El KPI
  «Problemas abiertos» sale como `1234`, no `1.234`. El mismo fichero importa `formatNumber` para
  otro valor (`:78`).
- `src/renderer/src/components/ProblemsTable.tsx:28-31`: `{item.affectedCount}` (columna
  Afectados).
- `src/renderer/src/components/EvidenceSection.tsx:529-531` (`{option.count}` en el menú de tipos)
  y `:826` (`{button.count}` en Todos/Abiertos/Cerrados).

El test de guardia `src/shared/format-number.test.ts` solo vigila `new Intl.NumberFormat`, así que
un número crudo en JSX no lo detecta.

**Impacto: medio.** Es la cifra más visible de la app y una decisión explícita de Dani (0012); en
inglés sale `1234` donde el resto dice `1,234`.

**Esfuerzo: pequeño.**

**Ficheros.** Los cuatro citados; `src/shared/format-number.test.ts`.

**Relaciones.** `app/i18n-numbers.ts` (los textos de i18next ya formatean); e2e de Inicio y de
Problemas en `views.spec.ts` (si alguno compara `"1234"` literal, cambiará).

**Solución propuesta.** `formatNumber(value, i18n.language)` en los cuatro (`formatCount` de
`lib/service-format.ts` ya hace eso con `null`). Test: ampliar la guardia de
`format-number.test.ts` con una pasada sobre `src/renderer/src/**/*.tsx` que falle ante
`{algo.length}`, `{algoCount}` o `{algo.count}` dentro de JSX fuera de atributos `aria-*` y
`data-*`; y un e2e con el simulador devolviendo `totalCount: 1200` que compruebe que
`kpi-open-problems` enseña `1.200`.

**Explicación.** El formateador global de i18next cubre los textos traducidos, pero un `{n}` suelto
en JSX no pasa por él. Con `Intl` en español, 1234 no lleva punto por defecto, y de ahí la regla.

### R-02. Búsquedas que piden a Dynatrace por cada texto distinto, desde un carácter

**Descripción.** Dos buscadores disparan una consulta de red con cada pausa de 300 ms:

- `src/renderer/src/pages/metrics/MetricSearch.tsx:27-32` → `useMetricSearch`
  (`data/modules.ts:642-652`, `enabled: envId !== null && text.trim() !== ''`): `metrics:search`
  (`GET /metrics`) con una sola letra.
- `src/renderer/src/pages/ProblemsPage.tsx:84-116`: el texto del filtro entra en la clave de
  `useProblems` → `problems:list` completo (hasta 500 problemas paginados) por cada texto, también
  con una letra.

Cada clave nueva es una consulta nueva y queda en caché (ADR-0004 lo admite para «filtros»), pero
teclear «builtin:host» a ritmo normal son entre 3 y 6 peticiones, y volver a escribir produce claves
distintas que vuelven a pedirse.

**Impacto: medio.** Cuota del tenant del cliente en el gesto más repetido de Métricas; el de
Problemas además trae listas grandes.

**Esfuerzo: pequeño.** Decisión de Dani: mínimo de letras y si el filtro de Problemas se aplica con
Enter.

**Ficheros.** `MetricSearch.tsx`, `ProblemsPage.tsx`, `data/modules.ts`, e2e `views.spec.ts`,
ADR-0004 (nota de actualización).

**Relaciones.** Canales `metrics:search` y `problems:list`; el limitador de main (6 en vuelo).

**Solución propuesta.** (a) Longitud mínima de 2 caracteres (o 3) antes de pedir, en
`useMetricSearch` y en `text` de `useProblems`, con el mismo `enabled`; (b) subir el retardo a 500 ms
y aplicar el filtro de texto de Problemas con Enter o al salir del campo (es la pauta de
`MetricSearch`: «Enter elige, nunca lanza»); (c) documentar la decisión en ADR-0004. Test e2e con
`sim.requests`: teclear 8 letras seguidas en `metric-search` produce como mucho 1 `GET /api/v2/metrics`
con el texto final; con 1 letra, ninguna.

**Explicación.** «Una clave nueva pide datos» está pensado para elegir un rango o un filtro, no para
cada pulsación. Un mínimo de letras y un retardo algo mayor convierten diez peticiones en una sin que
el usuario lo note.

### R-03. El enlace al host de la tabla de instancias no se alcanza con el teclado

**Descripción.** `src/renderer/src/pages/entities/ProcessGroupInstancesTable.tsx:94-110`: la celda
«Host» es un `Link` con `tabIndex={-1}` y `onClick` con `stopPropagation` («Abre el host, no la
instancia de la fila»). Con el teclado, la única acción de la fila es Enter
(`DataGrid.tsx:355-361` → `onActivate` → `open`), que abre la **instancia**, no el host; el enlace
al host solo se puede pulsar con ratón. En `HostTables.tsx` el mismo `tabIndex={-1}` es inofensivo
porque Enter en la fila abre el mismo destino que el enlace. Se usa en la tarjeta de la página y en
el modal «Ver todas» (fichas 0032 y 0051).

**Impacto: medio.** Accesibilidad: una función (ir al host desde el grupo) sin ruta por teclado; el
proyecto tiene roving tabindex y `aria-sort` cuidados en el resto.

**Esfuerzo: pequeño.**

**Ficheros.** `ProcessGroupInstancesTable.tsx`, `components/DataGrid.tsx`, e2e de process group en
`views.spec.ts`.

**Relaciones.** `DataGrid` (`onKeyDown` ya deja pasar Enter si el foco no está en un `role="row"`).

**Solución propuesta.** Quitar `tabIndex={-1}` del enlace del host (el del nombre puede quedarse:
duplica la acción de la fila). Tab desde la fila entra en el enlace y Enter navega sin que `DataGrid`
lo intercepte. Si se quiere evitar una parada de tabulación por fila, alternativa: en `DataGrid`,
flecha derecha/izquierda mueve el foco a los enlaces de la fila activa. Test e2e: con el foco en una
fila, Tab y Enter llevan a `entity-page-host` con el id esperado.

**Explicación.** Un enlace con `tabIndex=-1` solo existe para el ratón. Vale cuando la fila ya hace
lo mismo; no cuando es la única puerta a otra página.

### R-04. Consultas locales sin `staleTime`: `tenants:list`, `environments:getActive` y `export:getSettings` se repiten en cada montaje

**Descripción.** `src/renderer/src/data/tenants.ts:20-21` fija `retry: false` y
`refetchOnWindowFocus: false`, pero deja `staleTime: 0` y `refetchOnMount: true`. `useTenants`,
`useActiveEnvironment` y `useExportSettings` (`data/modules.ts`) no lo cambian. Cada `ExportMenu`
usa los tres: en el detalle de un problema cada mini gráfico que entra en pantalla monta un
`ExportMenu`, y con 30 evidencias son 90 llamadas IPC, cada `tenants:list` con una consulta SQL
por entorno (`src/main/ipc/handlers/tenants.ts`). Lo mismo al abrir el selector, Ctrl+K o cambiar
de página. Además `useTenantMutation.onSettled` (`:197-204`) invalida `tenants`,
`activeEnvironment`, `connectionStatus` y `certificatePins` para **cualquier** canal, también
`environments:setActive`.

**Impacto: bajo-medio.** No toca la cuota de Dynatrace (todo es local), pero es trabajo de main y
repintados sin motivo, y contradice el espíritu de ADR-0004 (las invalidaciones de estos datos ya
son explícitas).

**Esfuerzo: pequeño.**

**Ficheros.** `data/tenants.ts`, `data/modules.ts`, `data/tenants.test.ts`.

**Relaciones.** `ConnectionPanel.tsx` y `ExportSettingsSection.tsx` ya invalidan o fijan la caché a
mano; `QueryCache.onError` invalida `tenants` ante `SECRET_UNREADABLE`; `useSecretsAvailable` pide
`refetchOnMount: 'always'` a propósito (no tocar).

**Solución propuesta.** `staleTime: Infinity` en `defaultOptions.queries` del `queryClient` (las
consultas de módulo ya lo tienen y las locales se invalidan explícitamente), o al menos en
`tenants`, `activeEnvironment` y `exportSettings`. En `onSettled`, invalidar `connectionStatus` y
`certificatePins` solo cuando `changedEnvironment` devuelve algo. Test en `data/tenants.test.ts` con
`QueryClient` real e `invoke` simulado: montar dos consumidores seguidos produce un solo
`tenants:list`; tras `secrets:set`, uno más.

**Explicación.** TanStack considera «vieja» una consulta a los 0 ms y la repite al montar cualquier
componente que la use. Cuando la app ya sabe cuándo cambian esos datos (al guardar), decirlo con
invalidaciones es más barato y más predecible que repetir la pregunta.

### R-05. `EvidenceSection.tsx` tiene 945 líneas

**Descripción.** Medido: `components/EvidenceSection.tsx` 945 líneas (12 componentes, las 10
definiciones de columna, la barra de filtros con `TypeMenu` y el resumen de causa raíz);
`components/DataGrid.tsx` 550; `pages/ProblemDetailPage.tsx` 424. Solo el primero está fuera de
escala: cada ficha de evidencias (0001, 0002, 0035, 0059, 0064) lo ha tocado, y la regla del
compilador (`toggleRow` fuera del JSX, `:632-634`) vive en medio de 300 líneas de JSX.

**Impacto: medio** (mantenibilidad: es el fichero más tocado del renderer). **Esfuerzo: medio.**

**Ficheros.** `EvidenceSection.tsx` → `EvidenceFilters.tsx` (estado, buscador, `TypeMenu`, selects),
`EvidenceDetail.tsx` (`ChangeCard`, `EventDetail`, `EvidenceProperties`, `AnalyzeEntityButton`,
`Times`), `evidence-columns.tsx` (columnas y celdas), dejando en `EvidenceSection.tsx` la
orquestación. `e2e/areas.json` (los ficheros nuevos al área de problemas).

**Relaciones.** `EvidenceMetricChart.tsx` importa `ProblemContext` de aquí; `problem-workbook.ts` y
`app/evidence-table.ts` no cambian; los `data-testid` deben seguir iguales.

**Solución propuesta.** Partir sin cambiar comportamiento ni testids; mover `ProblemContext` a
`app/evidence-table.ts` para que `EvidenceMetricChart` no dependa del componente. Lo cubren los e2e
actuales de evidencias; `npm run test:e2e:affected`.

**Explicación.** Un fichero grande no es un fallo, pero sí el sitio donde más cuesta revisar un
cambio y donde una regla sutil (la del compilador) se pierde. Partirlo por responsabilidad deja
cada pieza del tamaño de las demás del proyecto.

### R-06. Visor de Markdown: dos comentarios que ya no son ciertos (alineación de tablas y notas al pie)

**Descripción.**

- `components/markdown-html.ts:13-15` dice que las marcas `data-vigia-slot` conservan «la alineación
  de tablas» del Markdown. Es cierto hasta el árbol, pero los componentes `th`/`td` de
  `components/MarkdownText.tsx:264-273` solo reenvían `style` y `title`: el `align` de GFM
  (`|:--|--:|`) se pierde, y `assets/main.css:376-387` fuerza `text-left`. Una tabla con columnas
  numéricas a la derecha sale toda a la izquierda.
- `MarkdownText.tsx:174-179` justifica conservar el `id` del título porque «el título de las notas
  al pie es el destino del `aria-describedby` de sus referencias». Pero el componente `a`
  (`:213-225`) convierte todo enlace no web (`#user-content-fn-1`) en un `<span>` sin `id`,
  `aria-describedby` ni `data-footnote-*`: la referencia queda como un «1» plano y el retorno como
  un «↩» suelto (ya anotado en el BACKLOG tras la 0064). El `id` del título no lo usa nadie.

**Impacto: bajo** (funcional y de coherencia; no de seguridad). **Esfuerzo: pequeño.**

**Ficheros.** `MarkdownText.tsx`, `markdown-html.ts`, `MarkdownText.test.ts`, `main.css`.

**Relaciones.** ADR-0008 (anclas como texto) y ADR-0011; e2e que buscan `p[role="heading"]`.

**Solución propuesta.** (a) En `th`/`td`, reenviar `align` como `style={{ textAlign: align }}` (es
un valor del propio Markdown, no del HTML escrito) y quitar `text-left` fijo del CSS. (b) Para las
notas al pie, decidir: o bien tratar los `href` que empiezan por `#user-content-` como saltos dentro
del visor (`scrollIntoView` del `id` con `preventDefault`, sin navegación, con nota en ADR-0008), o
bien ocultar el «↩» y corregir el comentario del título. Tests en `MarkdownText.test.ts`:
`|a|b|\n|:--|--:|` deja el segundo `td` con `text-align: right`; `[^1]` no deja un «↩» suelto.

**Explicación.** Las marcas protegen las propiedades del Markdown en el saneado, pero el último paso
(el componente de React) decide qué llega al DOM; si descarta un atributo, el trabajo anterior no
sirve. Un comentario que promete algo que el código no hace es peor que ninguno.

### R-07. `parseColor` resuelve nombres por el prototipo de `NAMED_COLORS`

**Descripción.** `components/markdown-color.ts:24` declara `NAMED_COLORS` como objeto literal y
`:200` lo consulta con `NAMED_COLORS[text]`. Con `color: constructor`, `__proto__`, `toString`,
`valueOf` o `hasOwnProperty`, `named` no es `undefined` (es una función o un objeto),
`hexToRgba('#function Object…')` devuelve canales `NaN` y `parseColor` no cumple su contrato
(«cualquier otra cosa da null»). Hoy no sale nada al DOM: todas las ramas de `paintElement`
comparan contrastes que con `NaN` dan `false` y descartan el `style`.

**Impacto: bajo** (robustez: una refactorización que confíe en `parseColor` podría llegar a escribir
`#NaNNaNNaN` en el `style`). **Esfuerzo: pequeño.**

**Ficheros.** `markdown-color.ts`, `markdown-color.test.ts`.

**Relaciones.** ADR-0011; `MarkdownText.html.test.ts` (CA2).

**Solución propuesta.** `const named = Object.hasOwn(NAMED_COLORS, text) ? NAMED_COLORS[text] :
undefined` (o un `Map`), y en `hexToRgba` rechazar lo que no cumpla `HEX`. Tests:
`parseColor('constructor')`, `parseColor('__proto__')` y `parseColor('toString')` devuelven `null`;
una descripción con `<span style="color:constructor">` sale sin `style`.

**Explicación.** Un objeto literal hereda de `Object.prototype`, así que «buscar una clave» también
encuentra `constructor`. Es el mismo motivo por el que `registry.ts` usa `Object.hasOwn` para los
tipos de entidad.

### R-08. Restos de duplicación en las páginas de entidad (lo que la guardia de la 0058 no ve)

**Descripción.** Las páginas nuevas (process group, aplicación, disco) sí usan las piezas comunes.
Quedan copias fuera de lo que vigila la guardia:

- `ProcessGroupInstancesTable.tsx:149-164` (`CpuCell`) es una copia literal de
  `HostTables.tsx:342-357`; `ApplicationActions.tsx:135-160` (`DurationCell`) es una tercera
  variante. Las tres calculan el ancho a mano en vez de `barWidth` de `EntityTables.tsx`. El
  BACKLOG ya anota `usageBar` como duplicado de `barWidth` (0058).
- `ProcessGroupInstances.tsx:39-106` y `ApplicationActions.tsx:44-68` repiten el estado
  error/esqueleto/vacío de `TableCard` porque necesitan contenido extra debajo de la tabla (también
  anotado en el BACKLOG).
- `host-info.ts:152-171` y `monitor-info.ts:162-181` conservan su `buildGroups` propio, idéntico al
  `buildRelationGroups` generalizado en `process-info.ts:130-153` que ya usan
  `process-group-info.ts`, `application-info.ts` y `disk-info.ts`.
- `HostEntityPage.tsx:41-43` calcula `eventsKnown` con `useConnectionStatusKnown` aunque
  `useEntityPageAccess` ya admite `extraEnvs`: el módulo extra sigue necesitando su propia espera
  fuera del hook.

**Impacto: bajo.** **Esfuerzo: pequeño.**

**Ficheros.** Los citados; `EntityTables.tsx`; el test de guardia de la 0058.

**Relaciones.** Fichas 0058, 0032, 0034, 0040; «Mejoras anotadas» del BACKLOG (varias de la 0058).

**Solución propuesta.** Un `BarCell` en `EntityTables.tsx` (`pct`, `testId`, `level?`, `text`) usado
por las tres tablas; `TableCard` con `footer?: ReactNode`; sustituir los dos `buildGroups` por
`buildRelationGroups`; añadir a `useEntityPageAccess` la espera de `statusKnown` para `extraEnvs`.
Ampliar la guardia para fallar si aparece más de una definición de `function buildGroups(` o
`function CpuCell(` en `pages/entities`.

**Explicación.** La regla de la carpeta se cumplió para lo grande y se está volviendo a copiar lo
pequeño. Es exactamente el patrón que la 0058 corrigió; conviene atajarlo con la misma guardia antes
de la cuarta copia.

### R-09. Pequeños del renderer

- **`EntityLocationState.fromProblem` ya no significa «desde un problema».** `app/entity-route.ts:13-18`
  lo documenta así, pero lo ponen las tablas del host, las instancias del grupo, el disco, los
  eventos y logs del host y las relaciones de `EntityInfoCard`. Renombrar a `canGoBack` y
  actualizar el comentario de `EntityPageFrame.tsx:49-54`.
- **Filas con aspecto de pulsables que no hacen nada.** `DataGrid.tsx:144` pone `cursor-pointer` a
  toda fila; `ApplicationActions.tsx:121`, `MonitorTables.tsx:139` y `:292` pasan
  `onActivate={() => undefined}`. Una prop `activatable?: boolean` en `DataGrid` que quite el
  cursor y no reaccione a Enter.
- **«CPU por instancia» sin instancias válidas pinta un gráfico vacío** en vez del estado «sin
  datos»: `process-group-charts.ts:70-75` devuelve `[]` y `ProcessGroupCharts.tsx:151-157` lo
  convierte en `lines: []` (gráfico en blanco con exportación activa). Mostrar el vacío del panel
  cuando `lines.length === 0`.
- **`CommentsSection.tsx:64-66` usa `key={index}`** para comentarios que cambian de lista al pulsar
  «Ver todos». Clave `${createdAt}-${index}`.

**Impacto: bajo.** **Esfuerzo: pequeño** (fichas ligeras).

### R-10. Contrato IPC: asimetrías menores (sin nada que abra un agujero)

**Descripción.** Revisado canal por canal: no hay `z.any()`, `z.unknown()` ni `passthrough` en
entrada (el `problemFilters: z.array(z.unknown())` de C-04 está en un esquema de respuesta de la
API, no en el contrato IPC); el único `looseObject` (`tenants.ts:157`) es deliberado. Quedan
asimetrías:

- `ipc.ts:266` `problems:list.text: z.string().max(30)` sin `.trim()`, mientras
  `metrics:search.text` y `metricSelector` sí lo llevan; hoy la interfaz recorta antes, pero el
  contrato no lo garantiza.
- `modules.ts:229` `metricResultSchema.warnings: z.array(z.string())` sin tope, frente al
  `.max(20)` de `problems:list` y de `export:*`: los avisos de `metrics:query` pasan luego a
  `export:table.warnings`, que sí tiene `.max(20)`, y un resultado con 21 avisos haría fallar la
  exportación con `INVALID_INPUT`. Es el único con un fallo real posible.
- `modules.ts:478` `hostEventSchema.entity.id: z.string().min(1)` no exige `entityIdSchema`, y
  `HostEvents.tsx:169-183` enlaza con él si el tipo tiene página; la página destino lo rechaza con
  «id no válido», así que no es un fallo, pero sería más coherente validar en main y no enlazar si
  no cumple (como hacen `processLinkId` y `diskLinkId`).

**Impacto: bajo.** **Esfuerzo: pequeño.** `exclusiones: [ipc]`.

**Ficheros.** `src/shared/ipc.ts`, `src/shared/modules.ts`, `MetricChartPanel.tsx:112` (recortar
avisos a 20 antes de exportar), `HostEvents.tsx`.

**Solución propuesta.** `.trim()` en `problems:list.text`; `.max(20)` (o deduplicar y recortar en
main como en `problems:list`) en `metricResultSchema.warnings` y en los `warnings` de los demás
resultados de métricas; `entityIdSchema` en `hostEventSchema.entity.id`. Tests: `ipc.test.ts` con
texto con espacios; exportar con 25 avisos no rechaza.

**Explicación.** Dos canales que describen lo mismo con reglas distintas acaban en un dato que uno
acepta y otro rechaza.

---

## Pendiente de la revisión anterior

Comprobado en el código a `c617ca7`. Hechas por las fichas 0055 a 0064: S-01, S-02, S-03, S-04,
S-05, S-07, C-01, C-02, C-03, C-05, C-06, C-08, C-09, C-10, C-11, C-13, C-14, M-01, M-02, M-03,
M-07 y M-14. Siguen abiertas, tal como se describieron entonces (ids y detalle en
`2026-10-09-revision-codigo.md`):

| Id   | Estado                                                                                        |
| ---- | --------------------------------------------------------------------------------------------- |
| S-06 | Fusible de integridad del asar: pendiente de Dani (propuesta 6; lo prueba antes de decidir).  |
| C-04 | `problemSchema` sigue exigiendo `problemFilters`, `impactedEntities` y `endTime: z.number()`. |
| C-07 | Los motivos de un entorno no importado siguen sin `reason` ni log.                            |
| C-12 | `savedQueries:delete` sigue sin `environmentId`.                                              |
| C-15 | `text()` recortado antes de escapar; pendiente de la prueba en vivo.                          |
| M-04 | `views.spec.ts` (13 961 líneas): en curso con la 0069 (hecha) y la 0070 (en espera).          |
| M-05 | ESLint sin reglas con tipos.                                                                  |
| M-06 | `pre-commit` sin `typecheck` para e2e y validando el disco (ver T-08, misma ficha).           |
| M-08 | Casts `as` en `repository.ts:31-33` y `config-file.ts:21`.                                    |
| M-09 | Tres `new Intl.DateTimeFormat` por libre (`EnvStatusCard`, `ExportMenu`, `ConnectionPanel`).  |
| M-10 | `app:ping` y el resto de código inalcanzable.                                                 |
| M-11 | Dos vías de transacción (`local-data.ts:60`, `handlers/tenants.ts:40-63`).                    |
| M-12 | 30 `waitForTimeout` en los e2e (27 en `views.spec.ts`).                                       |
| M-13 | `@shared` en cinco configuraciones; Vitest sin `@renderer`.                                   |
| M-15 | Sin `.npmrc` con `engine-strict`; flags de tsconfig; textos literales en e2e.                 |

Lote sugerido para lo pequeño de main: **C-04 + C-07 + C-12 + M-08 + M-11** (módulos y tenants, sin
canal IPC nuevo salvo C-12, que lleva `exclusiones: [ipc]`); para el renderer, **M-09** como ficha
ligera; para tooling, **M-05 + M-13 + M-15** y **M-06 con T-08**.

---

## Qué no se ha revisado

- Nada se ha ejecutado: ni `check`, ni e2e, ni pruebas en vivo, ni el zip. En este checkout falta
  `node_modules`: antes de empezar cualquier ficha, el primer paso del `CLAUDE.md`
  (`npm ci --ignore-scripts` y `npx install-electron`).
- El comportamiento real de electron-log con `cause` (P-03), de ExcelJS con nombres de hoja
  inválidos (P-05) y de `hast-util-sanitize` (lo que está bien del visor): leído, no visto pasar.
- `e2e/views.spec.ts` y `fixtures.ts`: solo estructura, no cada test.
- La ejecución real de `gh pr checks` y `gh pr merge` con el token de Dani (T-03): solo lo que los
  comandos dicen que se hace.
- `docs/especificacion.md` (local, no versionado) no se ha consultado: si alguna decisión de las
  propuestas (mínimo de letras en R-02, notas al pie en R-06, versionar `docs/revisiones/`) ya está
  cerrada ahí, prevalece.
