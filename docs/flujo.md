# Flujo de trabajo

Cómo se trabaja en Vigía con agentes (ADR-0007). El `CLAUDE.md` raíz tiene el resumen; aquí está
el detalle. El repositorio es la única memoria: los agentes arrancan vacíos y se ponen al día
leyendo. Si algo no está escrito, para ellos no existe.

## Quién es quién

| Quién        | Dónde                                  | Qué hace                                                                                   |
| ------------ | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| Dani         | —                                      | Pide, decide y aprueba. Prueba a mano (`docs/pendiente-dani.md`).                          |
| Planificador | Sesión 1 (antes, peticiones)           | Convierte peticiones en fichas, o en lotes. Decide en nombre de Dani si lo delega.         |
| Orquestador  | Sesión 2 (worktree propio)             | `/tarea NNNN [MMMM …]` (en cola) y `/cerrar-version`. Coordina; no escribe código.         |
| test-writer  | Subagente del Orquestador              | Tests desde la ficha, antes del código. Tienen que fallar.                                 |
| developer    | Subagente del Orquestador              | Implementa hasta verde. No toca los tests.                                                 |
| reviewer     | Subagente del Orquestador              | Revisa el diff sin contexto previo. Solo lectura. (Antes, senior.)                         |
| verifier     | Subagente del Orquestador              | Repite `check` y los e2e afectados en un worktree limpio. (Antes, test.)                   |
| doc-writer   | Subagente del Orquestador              | CHANGELOG, BACKLOG, ADR, ARCHITECTURE y el resultado de la ficha.                          |
| Hooks de git | `.githooks/` (sin IA)                  | Pre-commit: lint, tipos, formato y unitarios relacionados. Pre-push: escaneo del tenant.   |
| CI           | GitHub Actions (sin IA)                | En Windows: `check` y e2e completo en cada PR; `check` y `dist:win` al fusionar en `main`. |
| Aviso        | `scripts/notify-telegram.mjs` (sin IA) | Mensaje a Telegram al terminar `/tarea` o `/cerrar-version`. Opcional.                     |

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
      hecha ◀──merge --squash en integra/…── verificada ◀──verifier (check + e2e)─────┘
        │                                    (y el doc-writer)
        └─▶ push de integra/… (pre-push: scan:tenant) ─▶ PR a main (3 a 5 fichas) ─▶ CI ─▶ fusión
```

- `bloqueada`: tres rondas sin aprobar, un test que el developer cree incorrecto, una decisión que
  no está en el repositorio o un fallo del verifier que no se arregla en dos intentos. El
  Orquestador para y se lo dice a Dani (o al Planificador, si Dani lo ha delegado).
- `en_espera`: en una cola, la ficha espera una respuesta de Dani (o que Dani fusione la PR de una
  ficha de la que depende); su rama se queda y la cola sigue con la siguiente que no dependa de ella.
  Se retoma con `/tarea NNNN`.
- `hecha` quiere decir integrada en su rama de integración: la ficha pasa a `hecha` dentro de su
  propio commit (ver "Git"). El doc-writer la deja `verificada`.
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
  cada una desde la rama de integración en curso (o desde `main` si no hay ninguna) y con su
  aviso. Si una espera a Dani o se bloquea, se avisa y la cola sigue con las que no dependen de
  ella. Al final, un aviso con el resumen.
- **Carril rápido o fichas ligeras** (`ligera: sí`, la marca el Planificador; ADR-0013): solo para
  fichas S que no tocan canales IPC, la API de Dynatrace, dependencias, el esquema, la seguridad ni
  servicios externos, y que además cumplen **todos** estos puntos:
  1. No añade componentes, funciones ni cálculos nuevos.
  2. No elimina nada visible para el usuario.
  3. No toca datos, API ni lógica.
  4. No hay ninguna decisión que preguntar a Dani.

  Si falla uno, va por el carril normal, y en la duda, `no`. El Planificador lo justifica punto por
  punto en la sección «Carril» de la ficha. La 0066 es el ejemplo de lo que no entra: añadía una
  función y un componente.

  No hay test-writer: el developer escribe primero los tests (commit solo de tests) y después el
  código. El reviewer comprueba además dos cosas: que los tests cubren cada criterio tal como está
  escrito y que el diff respeta la clasificación. Si no la respeta, lo dice y se anota para afinar
  el criterio; la ficha sigue. El verifier, los hooks y el CI no cambian, y la ficha se agrupa en
  una PR como las normales.

- **El carril rápido no espera detrás de las normales** que aún no han empezado: pasa delante en
  cuanto acaba la ficha en curso, sin interrumpirla. Hacerla a la vez que otra necesita paralelismo
  (ADR-0013, parte 2).

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
  exactas, `node_modules`, `out`, `dist`, tests, empaquetar, commits, `git merge --squash` en
  una rama `integra/…`, `git push origin integra/…`, abrir PR a `main` y fusionar las PR
  agrupadas con «CI ok» en verde y el visto bueno del reviewer y del verifier en cada ficha),
  lecturas del tenant de pruebas y matar procesos del equipo.
- **Se pregunta a peticiones:** borrar o mover lo que no está en git (`docs/especificacion.md`,
  `%APPDATA%\vigia`, `.env.live.local`, `..\API\` y nada fuera del repositorio), escrituras en el
  tenant, cambios globales en la máquina, y `git reset --hard`, `checkout --`, `clean` o
  `stash drop` con cambios sin commitear (salvo commit o stash previo).
- **Solo lo decide Dani:** force push, reescribir el historial publicado, borrar ramas remotas
  (las borra GitHub al fusionar la PR), fusionar la PR de una ficha sola (la que toca alguna
  exclusión), la configuración de GitHub (protección de `main`, permisos del token de `gh`),
  tags, releases, publicar el zip, licencia y temas legales, y el qué de las funciones sin definir.
  El zip nunca se arranca en su perfil.
- Antes de cada tanda grande de cambios en la spec, copia como
  `docs/.respaldo/especificacion.AAAAMMDD-HHmm.md` (carpeta ignorada), conservando las 5 últimas;
  borrar las más antiguas de esa carpeta está autorizado, y nada más.

## Git

Se integra por PR (ficha 0073, ADR-0014): un commit por ficha en una rama de integración, y una PR a
`main` con 3 a 5 fichas.

- **Rama de la ficha:** `feat/NNNN-slug` (o `fix/NNNN-ci`, con el campo `rama` de la ficha
  cambiado), local y sin publicar, creada en el worktree del Orquestador desde la rama de
  integración en curso (si no hay ninguna, se crea antes), o desde `main` si la ficha va sola. Los
  rangos de la ficha (reviewer, verifier y e2e afectados) son `<base>..<rama>`, con la base de la
  que salió.
- **Rama de integración:** `integra/AAAAMMDD-N` (N empieza en 1 cada día), creada desde `main` o
  desde la rama de integración anterior si su PR aún no se ha fusionado. Se publica con
  `git push origin integra/AAAAMMDD-N`; el push no lanza el CI (solo lo lanzan las PR y `main`).
- **Ciclo de vida de una `integra/…`:** está **en curso** mientras no tiene PR, y solo ella recibe
  fichas y documentos. En cuanto se abre su PR, deja de estar en curso: ya solo recibe el commit
  `fix(…)` de una `fix/NNNN-ci` (ver "El CI, sin esperarlo") y el merge de `origin/main` si hay
  conflictos; las fichas siguientes van a una `integra/…` nueva, que sale de esta mientras su PR
  no se fusione. La de una ficha sola nunca está en curso: sale de `main`, lleva solo esa ficha y
  abre su PR enseguida. Si GitHub dice que la PR tiene conflictos con `main` (lo normal, en
  `CHANGELOG.md` o `BACKLOG.md`): en la `integra/…`, `git fetch origin` y
  `git merge --no-edit origin/main`, se resuelven, se commitea el merge y, si la resolución toca
  algo más que documentos, se repite el verifier sobre la `integra/…` antes de
  `git push origin integra/…`. Nunca rebase ni force push de una `integra/…` publicada.
- **Traer `main`** (lo hace el Orquestador al empezar cada ficha, antes de abrir una PR y tras
  fusionar una): el Planificador commitea las fichas aprobadas en `main` local, sin push, así que
  `main` local puede llevar commits que no están en `origin/main`. El camino es uno:
  1. `git fetch origin` y, en el checkout principal (la ruta sale de `git worktree list`),
     `git merge -m "chore(git): trae origin/main" origin/main` con `git -C <checkout principal>`.
     Si `main` local no lleva nada propio, avanza sin más; si lleva documentos del Planificador,
     deja un merge en `main` local, sin push. Si `git -C <checkout principal> status --porcelain`
     no está vacío (cambios sin commitear del Planificador), no se empieza; si el merge da
     conflicto, `git -C <checkout principal> merge --abort`. En los dos casos se para la cola y se
     avisa a Dani (y al Planificador): nunca se resuelven conflictos en el checkout de otra sesión.
  2. Si hay una `integra/…` en curso y `git log --oneline integra/…..main` no está vacío, en ella
     `git merge -m "chore(git): trae main" main`. Si no hay ninguna, la siguiente `integra/…` sale
     de `main` (o se le hace ese mismo merge, si sale de la anterior) y los lleva; antes de abrir
     una PR se repite, por si el Planificador ha commiteado entretanto. Si la cola acaba sin
     ninguna en curso y `git log --oneline main --not origin/main <integra/… con PR abierta>` (lo
     que no va en ninguna PR abierta) no está vacío, se abre una PR solo de documentos:
     `integra/AAAAMMDD-N` desde `main`, push, PR y fusión con «CI ok» en verde.

  Así `main` local siempre está contenido en lo que acaba en `origin/main`, y el paso 1 nunca
  necesita reescribir nada.

- **Un commit por ficha.** Con el doc-writer hecho (la ficha queda `verificada`), en la rama de la
  ficha: `node scripts/integrate.mjs tasks/NNNN-slug.md <zona>` comprueba que la ficha está
  `verificada`, que el árbol está limpio y que la rama es la suya, y escribe el mensaje
  (`feat(zona): título (#NNNN)`, o `fix(…)` si la rama es `fix/`); si algo falla, da los motivos
  y sale con 1. Se guarda el mensaje en un fichero, se cambia a la rama `integra/…`,
  `git merge --squash <rama de la ficha>`, se pone `estado: hecha` en la ficha (`git add`) y
  `git commit -F <fichero>`. Los commits del developer y el cierre del doc-writer van juntos en
  ese commit. La rama de la ficha se borra en local con `git branch -D` (el squash no la marca como
  fusionada).
- **Qué va en cada PR** (`groupForPrs` de `scripts/integrate.mjs`, que el Orquestador usa para
  decidir con `node scripts/integrate.mjs --agrupar <fichas en el orden de la cola>`): una ficha
  con alguna `exclusiones` (`ipc`, `api`, `dependencias`, `esquema`, `seguridad` o `externos`), o
  sin el campo (las de antes de la 0073), va sola y **la fusiona Dani**. Si el campo no es una
  lista (`exclusiones:` vacío o `exclusiones: ipc`), el script sale con 1 y se corrige la ficha.
  Las demás, rápidas o normales, se juntan en el orden de la cola de 3 a 5: la PR se abre al llegar
  a 5, al llegar a 3 si no quedan más agrupables en la cola, o al acabar la cola con las que haya.
  Una ficha sola en medio no corta el grupo en curso.
- **PR agrupada:** `gh pr create --base main --head integra/…`, con título «Fichas NNNN, MMMM…» y
  en el cuerpo la lista de fichas con su título y el enlace a su fichero, sin nada del tenant. No se
  espera al CI (ADR-0013): se sondea en segundo plano (`gh pr checks`) y, con «CI ok» en verde, se
  fusiona con `gh pr merge --merge` («Create a merge commit»: `main` conserva un commit por ficha
  con los mismos SHA; «Rebase» obligaría a un force push y «Squash» juntaría las fichas). GitHub
  borra la rama remota al fusionar; los agentes no borran ramas remotas.
- **PR de una ficha sola:** su rama `integra/…` sale de `main`, no de una rama de integración
  pendiente. El Orquestador la abre, **no la fusiona** y avisa a Dani (`parada`, con el enlace de
  la PR y el estado de «CI ok»). La cola sigue con las fichas que no dependan de ella; las que
  dependen quedan `en_espera` hasta que Dani la fusione.
- **Documentos sin código** (la ficha aprobada que commitea el Planificador en `main` local, la
  medición del CI que llega después): van en la rama de integración en curso; si no hay ninguna, en
  una PR solo de documentos, que «CI ok» deja pasar en segundos. Los del Planificador llegan con
  "Traer `main`"; la medición la commitea el doc-writer de la ficha siguiente o, si no hay, el
  Orquestador en la `integra/…` en curso (o en la PR solo de documentos).
- **Tras fusionar una PR:** "Traer `main`", para que la rama siguiente salga del `main` de GitHub.
- **Push:** `git push origin integra/<nombre>` (solo ramas con ese prefijo). `git push origin main`
  solo integró esta ficha (0073, el paso 1 de su puesta en marcha); desde la ficha siguiente no es
  una vía para integrar fichas, aunque la protección de `main` aún no esté activa, y nunca lo fue
  para una ficha con exclusiones. Si `gh` no está disponible, se para y se avisa a Dani. Con la
  protección activa (`main` solo admite PR con «CI ok», también para administradores), GitHub lo
  rechaza. Nunca `--force` ni `--force-with-lease`. Sin tags, releases ni subir el zip a GitHub.
- **`gh`** usa un token fine-grained de este repositorio (Contents y Pull requests de lectura y
  escritura, sin administración) que configuró Dani; los agentes nunca lo ven, escriben ni guardan.
  Si `gh pr checks` o `gh run view` no pueden leer el CI con esos permisos, se le dice a Dani y él
  decide; no se amplía por cuenta propia.
- Antes de cada push (el pre-push lo hace solo): `npm run scan:tenant`. Además, revisar el contenido
  sensible: autor y committer noreply, sin `docs/especificacion.md`, sin nombres de clientes,
  secretos, URLs o IDs de tenants reales, logs ni `.env`.
- Commits pequeños por funcionalidad en la rama de la ficha, en español, con el número de la ficha:
  `feat(problemas): agrupa por clúster (#0003)`. Tests para la lógica de main.
- En PowerShell, `git commit -F -` con un here-string no lee el mensaje de la entrada: escribir el
  mensaje en un fichero y usar `git commit -F <fichero>`.

### El CI, sin esperarlo (ADR-0013)

El Orquestador no espera al CI de una PR para empezar la siguiente ficha. Lo sondea en segundo
plano y, cuando acaba, fusiona la PR (si es agrupada) y manda el aviso de sus fichas, con el enlace.
Lo mismo con el CI de `main` que lanza cada fusión (`check` y `dist:win`). **Si falla,
se para la cola** (con la PR, o la fusión en `main`, como run):

1. No se lanza ningún subagente más. El que esté trabajando acaba su paso (no se corta a medias) y
   su ficha se queda en su rama, `en_espera`.
2. Se localiza la ficha culpable. Una PR agrupada cubre de 3 a 5 fichas (y una fusión en `main`,
   las de su PR más lo que ya había): se busca por el test que falla y el diff de cada ficha (un
   commit cada una) y, en la duda, el verifier pasa ese spec en el commit de cada una.
3. Se relanza el job que falló, una sola vez. Si pasa, el spec queda anotado en «Mejoras anotadas»
   del BACKLOG como sospechoso de inestable, con la fecha y el run. Son los datos de la cuarentena
   (ADR-0013, ficha B). La cola sigue.
4. Si vuelve a fallar, se reabre la ficha culpable: `en_desarrollo`, rama `fix/NNNN-ci` (también en
   su campo `rama`) desde la rama de integración de la PR que falló (o desde `main`, si ya estaba
   fusionada). Developer con el fallo, reviewer y verifier; el doc-writer lo añade a su
   «Resultado» y se integra con su commit `fix(…)` en esa misma rama, que actualiza la PR. Si el
   arreglo se sale del alcance de la ficha, se para y se pregunta. Con dos intentos sin verde,
   `bloqueada` y su aviso.
5. Con el CI en verde, la cola sigue. La ficha que esperaba se rebasa sobre su base al día y, si el
   rebase toca algo más que documentos, se repite su verifier.

## Niveles de prueba

- **Base de los rangos:** `<base>` es la rama de la que salió la ficha (la `integra/…` en curso
  o `main`), y se la pasa el Orquestador a cada subagente; sin ella, `main`.
- **Durante el desarrollo (developer, ADR-0013):** solo los e2e de su ficha. Compila una vez
  (`npm run build`) y lanza `npm run test:e2e:affected -- <base>..HEAD --no-build -g "(NNNN)"` (o
  `npm run test:e2e:nobuild -- <spec> -g "(NNNN)"` si sabe el spec). `--no-build` no comprueba si
  `out/` está al día. Vuelve a compilar solo si cambia algo fuera de `e2e/`, porque los e2e corren
  sobre `out/`. Tras un arreglo, solo lo que falló (`--last-failed`), y nunca repite una tanda si
  el código no ha cambiado. Mientras itera con los unitarios, `vitest related <ficheros>` o
  `--changed`. Termina con `npm run check` y, una sola vez, los specs de las zonas cuyo código
  fuente ha modificado, según `e2e/areas.json` (`npm run test:e2e:affected -- <base>..HEAD`). No
  basta con los specs cuyos tests ha tocado: una regresión sale en el spec que no se ve venir, como
  el centrado de la 0012 en la 0066. Si aun así se escapa algo, lo encuentra el verifier.
- El e2e local ya corre con la ventana del CI (1024×720): los specs la fijan al arrancar la app.
- **Por ficha (verifier):** en un worktree propio en su scratchpad, `npm run check` y un único
  pase de `npm run test:e2e:affected -- <base>..<rama>`. No repite lo que ya está en verde
  para el mismo commit. Los tests ya llevan su etiqueta de zona (ficha 0067), pero hasta la 0071
  los afectados siguen saliendo de las áreas de `e2e/areas.json`.
- **Etiquetas de zona (ficha 0067):** cada test de `e2e/*.spec.ts` lleva exactamente una zona de
  `zones` (`e2e/areas.json`), propia o de su `test.describe`, y `@portapapeles` si usa el
  portapapeles del sistema. Una zona se lanza con `npm run test:e2e:nobuild -- --grep @zona`. La
  guarda `scripts/e2e-tags.test.ts` (en `check`) falla si un test no tiene zona, tiene dos, usa
  una etiqueta desconocida o el portapapeles sin `@portapapeles`, o si una zona no tiene tests.
- **Transversal** (lo decide `e2e/areas.json`): e2e completo. Los locales y `main.css` no son
  transversales: los cubren el test de paridad y el de contraste (los dos en `check`) y disparan el
  área shell, más la del módulo si el diff toca uno. `scripts/**` está en ignore porque solo
  contiene herramientas de desarrollo; un script que intervenga en el build o el empaquetado va a
  `build/` o se saca del ignore.
- `--repeat-each 3` solo en specs concretos sospechosos de ser inestables: uno cuyo diff toca
  temporización (esperas, animaciones, virtualización, navegación), uno que falló una vez o uno
  anotado como inestable en el BACKLOG. Nunca la suite entera. `views` va con `--workers=1`.
- **Al cerrar una versión:** e2e completo dos veces, `--repeat-each 3` en los specs cambiados desde
  la versión anterior y `npm run dist:win`.
- **Clon limpio** (en el scratchpad, con la instalación del README, `npm run check`,
  `npm run test:e2e` completo y `npm run dist:win`) solo si cambian las dependencias, el
  empaquetado o la instalación (`package*.json`, scripts de npm, electron-builder). Comprobarlo en
  el árbol de trabajo no basta: ahí ya está todo instalado.
- Un criterio de aceptación manual no se da por cumplido; solo lo confirma Dani.

## Medición del flujo

Solo en las fichas con `medir: sí`, que decide Dani (ADR-0013; las 0065 y 0066 son el modelo). La
ficha lleva una sección «Medición del flujo» con dos tablas:

- **Pasos:** agente, ronda, inicio, fin, duración y notas.
- **Ejecuciones:** quién, comando, inicio, fin, duración, resultado y tests (pasan, fallan y
  saltados; unitarios y e2e por separado). Cada repetición va en su fila.

Las reglas:

- Las horas salen de `date "+%Y-%m-%d %H:%M:%S"`, nunca estimadas. Lo que no se puede medir se dice
  tal cual.
- El Orquestador pasa la instrucción a cada subagente. Los subagentes devuelven sus filas y el
  Orquestador las copia, salvo el doc-writer, que escribe las suyas.
- Se desglosa el tiempo del Orquestador y el **arranque de cada subagente**: la hora que toma el
  Orquestador justo antes de lanzarlo frente a la del primer comando del subagente.
- Las esperas de Dani y las de la cola van en su propia fila.
- Los tiempos del CI salen de `node scripts/ci-times.mjs <run>` (id o URL del run): filas de
  «Ejecuciones» con inicio y fin de cada job y de cada paso en hora local, y el total del run. Lee la
  API de GitHub sin token (con `GITHUB_TOKEN` en el entorno, lo usa sin escribirlo) y nunca copia
  logs.
- La medición va en el commit de documentación. En una PR, «CI ok» deja pasar en segundos lo que
  solo toca `tasks/`, `docs/` o Markdown, y el push a `main` lo ignora (`paths-ignore`).
- Como el CI no se espera, sus horas llegan cuando la ficha ya está integrada. No llevan rama
  propia. El Orquestador se las pasa al doc-writer de la ficha siguiente, que las añade a la ficha
  medida en su commit de cierre, con los totales. Si no queda ninguna ficha detrás, van en la rama
  de integración en curso o, si no hay, en una PR solo de documentos ("Git").
- Los totales van en «Resultado»: reloj de la petición al CI en verde, tiempo por agente, esperas,
  número de ejecuciones y tests.

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

- `/tarea`: `hecha` (con el CI de su PR acabado, con el enlace), `bloqueada` (tres rondas sin
  aprobar, con el motivo) o `parada` (esperando una decisión de Dani, con la pregunta; también al
  abrir la PR de una ficha sola, con su enlace y el estado de «CI ok»). Un `[ALCANCE]` que
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
- **Pre-push** (`.githooks/pre-push`): `scan:tenant` sobre lo que se sube (`remote..local` de cada
  ref que git pasa por la entrada estándar; rama remota nueva, `origin/main..local`). Falla cerrado:
  sin `.env.live.local`, o con él vacío, sale con 2 y el push no se hace. Lo busca en el directorio
  actual y, si no está, en el checkout principal (los worktrees de Orca no lo tienen). Sin nada que
  subir, deja pasar. `VIGIA_SCAN_TENANT_OPTIONAL=1` (solo ese valor) lo hace opcional, con 0 y un
  aviso: para clones sin tenant de pruebas; en la VPS no se usa.
- **CI** (`.github/workflows/ci.yml`), en `windows-latest` con la instalación del README: en cada
  PR a `main` (y a mano), `npm run check` y `npm run test:e2e` completo, sin `dist:win`; en el
  push a `main` (al fusionar una PR), `npm run check` y `npm run dist:win` (sin subir el zip), sin
  e2e, que ya pasó en la PR: el `check` caza dos PR que pasaron cada una por su lado y fallan
  juntas. El check «CI ok» existe siempre (job `ci-ok`) y es el único que exige la protección de
  `main`; en una PR solo de documentos pasa en segundos (`scripts/ci-changes.mjs`). El push a
  `main` no se lanza si solo toca Markdown, `docs/`, `tasks/` o `.claude/` (`paths-ignore`), y
  el push a las ramas `integra/` no lo lanza nunca. Sin `test:live` ni secretos: los logs del CI
  son públicos. Además: `npm audit` (producción `high` bloquea; desarrollo `critical` solo
  avisa); acciones fijadas por SHA de 40 hexadecimales con la versión en un comentario (lo exige
  `scripts/ci-workflow.test.ts`); en `main`, runs encolados, sin cancelar (en una PR, el push
  nuevo cancela el run anterior); caché de Electron con su versión en la clave (al subir Electron,
  cambiarla); y `test-results/` como artefacto 7 días si fallan los e2e.
  `audit.yml` repite el audit cada lunes y a mano.
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
