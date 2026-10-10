---
description: Ejecuta el flujo completo de una o varias fichas aprobadas de Vigía, en cola. Uso: /tarea 0004 o /tarea 0006 0007 0008
argument-hint: <número de ficha> [más números, en orden]
---

Fichas: `$ARGUMENTS` (una o varias, en ese orden). Eres el Orquestador: no escribes código ni
tests. Coordinas, vigilas el estado de cada ficha y escribes en ella lo que te devuelven los
subagentes. El detalle del flujo está en `docs/flujo.md`.

**Cola** (si hay más de un número; con uno solo, es lo mismo con una ficha):

- Las fichas se hacen una detrás de otra, en el orden dado, cada una entera (pasos 1 a 10) antes de
  empezar la siguiente, y cada una desde la rama de integración en curso (`integra/AAAAMMDD-N`,
  que se crea si no hay ninguna) o, si la ficha va sola, desde `main`. El CI no se espera
  (paso 10).
- **Agrupar en PR** (`docs/flujo.md`, "Git"): antes de empezar la cola, lee el campo `exclusiones`
  de cada ficha y pasa la cola por `groupForPrs`:
  `node scripts/integrate.mjs --agrupar tasks/NNNN-….md tasks/MMMM-….md …`, en el orden de la cola,
  da las PR en JSON. Una ficha con alguna exclusión, o sin el campo, va sola en su PR y la fusiona
  Dani; las demás se juntan de 3 a 5 en el orden de la cola. Una ficha sola en medio no corta el
  grupo en curso.
- Carril rápido (`ligera: sí`; ADR-0013): no espera detrás de las normales que aún no han empezado.
  Pasa delante en cuanto acaba la ficha en curso, sin interrumpirla. Si te llega una ficha nueva
  del carril rápido mientras trabajas, la pones la siguiente.
- **Si falla el CI de una PR (o el de `main` tras fusionarla), se para la cola** (`docs/flujo.md`,
  "El CI, sin esperarlo"): no lanzas ningún subagente más y el que esté trabajando acaba su paso;
  su ficha queda `en_espera` en su rama. Después localizas la ficha culpable y relanzas el job que
  falló una sola vez. Si pasa, el spec queda en el BACKLOG como sospechoso de inestable (fecha y
  run, para la ficha B) y sigues. Si vuelve a fallar, reabres la culpable (`en_desarrollo`, rama
  `fix/NNNN-ci` desde la rama de integración de esa PR, o desde `main` si ya estaba fusionada, y
  `rama: fix/NNNN-ci` en su ficha) y la llevas por developer, reviewer, verifier, doc-writer e
  integración (su commit `fix(…)` en esa misma rama de integración) antes de seguir. Si el arreglo
  se sale de su alcance, para y pregunta. Con dos intentos sin verde, `bloqueada` y **Aviso**. Con
  el CI en verde, retomas la que esperaba: rebase sobre su base al día y, si toca algo más que
  documentos, repites su verifier.
- Antes de empezar una, mira su `depende_de`: si alguna de esas fichas no está `hecha`, se salta y
  se dice en el resumen final. Si depende de una ficha sola cuya PR aún no ha fusionado Dani, queda
  `en_espera` hasta que la fusione.
- Si una ficha se para esperando a Dani (`[ALCANCE]` no delegado o cualquier "para y pregunta"):
  apunta la pregunta en la ficha (`estado: en_espera`, con la pregunta en "Notas del revisor" o en
  "Resultado"), manda el **Aviso** de `parada`, deja su rama como está y sigue con la siguiente
  ficha que no dependa de ella. Cuando Dani responda, se retoma con `/tarea NNNN` (rebase de la rama
  sobre su base al día y se sigue por donde iba).
- Si una ficha queda `bloqueada`, igual: **Aviso**, su rama se queda y se sigue con la siguiente.
- **Ramas de integración** (`docs/flujo.md`, "Git"): la `integra/…` **en curso** es la que aún no
  tiene PR, y solo ella recibe fichas y documentos. Con su PR abierta, solo recibe el `fix(…)` de
  una `fix/NNNN-ci` y el merge de `origin/main` si hay conflictos; las fichas siguientes van a una
  `integra/…` nueva, que sale de ella mientras su PR no se fusione (o de `main`, si ya se fusionó).
  La de una ficha sola nunca está en curso: sale de `main`, lleva solo esa ficha y abre su PR.
- **Conflictos de una PR con `main`** (lo normal, `CHANGELOG.md` o `BACKLOG.md`): en su
  `integra/…`, `git fetch origin` y `git merge --no-edit origin/main`, los resuelves, commiteas el
  merge y, si la resolución toca algo más que documentos, repites el verifier sobre la
  `integra/…`; después `git push origin integra/…`. Nunca rebase ni force push de una `integra/…`
  publicada.
- **Traer `main`** (`docs/flujo.md`, "Git"; el Planificador commitea las fichas aprobadas en
  `main` local, sin push): al empezar cada ficha (paso 2), antes de abrir una PR (paso 9) y tras
  fusionar una (paso 10):
  1. `git fetch origin` y, en el checkout principal (la ruta sale de `git worktree list`),
     `git merge -m "chore(git): trae origin/main" origin/main` con `git -C <checkout principal>`.
     Si `main` local lleva documentos del Planificador, queda un merge en `main` local, sin push.
     Si `git -C <checkout principal> status --porcelain` no está vacío (cambios sin commitear del
     Planificador), no lo empiezas; si el merge da conflicto,
     `git -C <checkout principal> merge --abort`. En los dos casos paras la cola y avisas a Dani
     (y al Planificador) con el **Aviso** de `parada`: nunca resuelvas conflictos en el checkout
     de otra sesión.
  2. Si hay una `integra/…` en curso y `git log --oneline integra/…..main` no está vacío, en ella
     `git merge -m "chore(git): trae main" main`. Si no hay ninguna, la siguiente sale de `main`
     (o se le hace ese merge, si sale de la anterior) y los lleva. Antes de abrir una PR se
     repite, por si el Planificador ha commiteado entretanto.
- Al acabar la cola: abre la PR del grupo en curso con las que haya (paso 9). Si no queda ninguna
  `integra/…` en curso y `git log --oneline main --not origin/main <integra/… con PR abierta>` (lo
  que no va en ninguna PR abierta) no está vacío, abre una PR solo de documentos
  (`integra/AAAAMMDD-N` desde `main`, push, PR y fusión con «CI ok» en verde). Después, un resumen
  para Dani (hechas, en espera con su pregunta, bloqueadas con el motivo, saltadas por
  dependencias, y las PR con su enlace y quién las fusiona) y el **Aviso** de la cola.

**Por cada ficha:**

1. Lee la ficha. Si su estado no es `aprobada` (o, al retomar, uno intermedio o `en_espera`), para
   y avisa. Si el árbol tiene cambios sin commitear, para y avisa.
2. **Traer `main`** (arriba). Después, `git switch -c <rama de la ficha> <base>` (o
   `git switch <rama>` si ya existe y retomas). Si la ficha va sola, la base es `main`. Si no, es
   la rama de integración en curso; si no hay ninguna, la creas antes sin cambiar de rama
   (`git branch integra/AAAAMMDD-N <origen>`, con `<origen>` la `integra/…` cuya PR aún no se ha
   fusionado o, si no hay, `main`) y le haces el punto 2 de "Traer `main`". Pásale la base a cada
   subagente: sus rangos son `<base>..<rama>` y `<base>..HEAD`.
3. Tests:
   - Ficha normal: **test-writer**, con solo la ruta de la ficha. Al volver, comprueba que la ficha
     está en `tests_escritos`, que hay commit de tests y que fallan por falta de código.
   - Ficha `ligera: sí` (`docs/flujo.md`, "Fichas ligeras"): no hay test-writer; el developer
     escribe primero los tests (commit solo de tests) y después el código, en el paso 4.
4. **developer**, con solo la ruta de la ficha (y "ficha ligera: tests primero" si lo es). Si dice
   que un test es incorrecto: si es un error del test, vuelve al test-writer con esa nota (en una
   ligera, lo corrige el developer y lo explica); si cambia lo que se pide, es `[ALCANCE]` (paso 6).
5. **reviewer**, con la ruta de la ficha y la ronda. En una ligera, dile que además compruebe que los
   tests cubren cada criterio tal como está escrito (los escribió el developer) y que el diff respeta
   la clasificación de la sección «Carril». Un `[CARRIL]` no bloquea: se anota en la ficha. Copia
   su respuesta en "Notas del revisor" y sube `rondas_revision`.
6. Si es CAMBIOS:
   - Si hay algún `[ALCANCE]`, pregúntaselo a Dani. Si Dani ha delegado en peticiones, envíaselo al
     Planificador con `SendMessage` (`ListAgents` para encontrar su sesión) y espera su respuesta.
     La decisión se anota en la ficha (criterio nuevo o "Fuera de alcance").
   - Si cambian criterios, vuelve al test-writer (solo los tests nuevos) y después al developer; si
     no, directamente al developer con la ruta de la ficha. Estado `en_desarrollo`.
   - Máximo 3 rondas. Si la tercera no se aprueba: `estado: bloqueada`, y se lo dices a Dani con el
     motivo y el **Aviso** (abajo).
   - Si el `[ALCANCE]` espera a Dani (no está delegado), **Aviso** con `estado: parada` antes de
     esperar (en una cola, ver arriba). Si lo decide el Planificador por delegación, no se avisa.
7. Con APROBADO, **verifier** en modo `ficha` con la rama, el rango `<base>..<rama>` y una carpeta
   de tu scratchpad. Copia su resultado en "Verificación". Si es ROJO, vuelve al developer con el
   fallo (cuenta como una ronda más) y repite la revisión. Si es VERDE: `estado: verificada`.
8. **doc-writer**, con la ruta de la ficha y la base. La ficha queda `verificada`.
9. Integración, un commit por ficha (`docs/flujo.md`, "Git"):
   - En la rama de la ficha,
     `node scripts/integrate.mjs tasks/NNNN-slug.md <zona> > <scratchpad>/msg-NNNN.txt` (la zona,
     la de sus commits). Si sale con 1, para y mira los motivos.
   - `git switch <base>` si es la `integra/…` en curso (paso 2); si la ficha va sola,
     `git switch -c integra/AAAAMMDD-N main`.
   - `git merge --squash <rama de la ficha>`, `estado: hecha` en la ficha, `git add` de la ficha y
     `git commit -F <scratchpad>/msg-NNNN.txt`. Después `git branch -D <rama de la ficha>`.
   - `git push origin integra/AAAAMMDD-N` (el pre-push pasa `scan:tenant`; el push no lanza el CI).
     Nunca `--force` ni `--force-with-lease`.
   - Abre la PR cuando toque (al llegar a 5, a 3 si no quedan más agrupables en la cola, al acabar
     la cola, o enseguida si la ficha va sola). Antes, "Traer `main`" (salvo en la de una ficha
     sola, que no está en curso) y, si ha traído algo, otra vez `git push origin integra/…`.
     Después, `gh pr create --base main --head integra/AAAAMMDD-N`, título «Fichas NNNN, MMMM…» y
     cuerpo con la lista de fichas, su título y el enlace a su fichero, sin nada del tenant. Desde
     ese momento la `integra/…` ya no está en curso. Si la ficha va sola, **no la fusiones**:
     **Aviso** de `parada` con el enlace de la PR y el estado de «CI ok», y sigue con lo que no
     dependa de ella.
   - Si `gh` no está instalado o sin sesión (`gh auth status`), para y avisa a Dani antes de abrir
     la PR; no integres por tu cuenta con `git push origin main`.
10. Sondea el CI de la PR en segundo plano (`gh pr checks <número>`) y **no lo esperes**: empieza ya
    la siguiente ficha de la cola. Cuando «CI ok» esté en verde, fusiona la PR agrupada con
    `gh pr merge <número> --merge` (nunca `--squash` ni `--rebase`; no borres la rama remota, la
    borra GitHub), "Traer `main`" (arriba), muestra a Dani el briefing del doc-writer de cada
    ficha, más las rondas, el resultado del verifier y el enlace al CI, y manda el **Aviso** con
    `estado: hecha` de cada una. Sondea también el CI de `main` que lanza la fusión (`check` y
    `dist:win`). Si algo falla, ver "Si falla el CI" arriba. Si `gh` no puede leer el CI con los
    permisos de su token, díselo a Dani; no los amplíes.

**Medición** (solo si la ficha tiene `medir: sí`; `docs/flujo.md`, "Medición del flujo"):

- Pásale a cada subagente la instrucción: horas de `date "+%Y-%m-%d %H:%M:%S"`, nunca estimadas, y
  sus filas de «Pasos» y «Ejecuciones» en la respuesta (el doc-writer las escribe él).
- Toma la hora justo antes de lanzar cada subagente y al recibir su respuesta, para el arranque y la
  vuelta.
- Copia las filas en la ficha, junto con las tuyas: commits con su hook, merge --squash, push, PR,
  fusión y esperas.
- Los tiempos del CI salen de `node scripts/ci-times.mjs <run>` (jobs y pasos, sin logs). Sin rama
  propia: guárdalos y pásaselos al doc-writer de la ficha siguiente, que los añade a la ficha medida en su commit de
  cierre, con los totales. Si no queda ninguna detrás, un commit de documentación en la rama de
  integración en curso o, si no hay, en una PR solo de documentos.

No saltes pasos ni hooks. Si algo no está escrito en el repositorio y hace falta decidirlo, para y
pregunta (con el **Aviso** de `parada`).

**Aviso** (`docs/flujo.md`; opcional, nunca para el flujo): escribe un JSON en tu scratchpad y
ejecuta `node scripts/notify-telegram.mjs <ruta-del-json>`. Campos: `tipo: "tarea"`, `ficha`,
`titulo`, `estado`, `resumen`, `rondas`, `verifier` (`VERDE` | `ROJO` | `sin pasar`), `ci` y
`decision`. Cuándo:

- `estado: hecha`: al fusionar su PR (paso 10), con el enlace del CI de la PR en `ci`.
- `estado: bloqueada`: tres rondas sin aprobar (también si la última fue un ROJO del verifier), con
  el motivo en `resumen` y el último resultado en `verifier`.
- `estado: parada`: esperando a Dani (`[ALCANCE]` no delegado o cualquier "para y pregunta"), con la
  pregunta en `decision`, escrita para contestarla desde el móvil (sí/no u opciones numeradas). Y
  al abrir la PR de una ficha sola: el enlace de la PR en `ci` y, en `decision`, que la fusione él
  (con el estado de «CI ok»).
- Fin de una cola de más de una ficha: `ficha` con el rango (`0006–0008`), `titulo: "Cola"`,
  `estado: hecha` si todas acabaron hechas o `parada` si alguna espera a Dani (con las preguntas en
  `decision`), y en `resumen` qué quedó en cada una.

El `resumen` lo redactas tú desde el briefing del doc-writer (o el motivo), en pocas líneas, sin
datos del tenant ni nombres de clientes: el filtro del script es la red de seguridad, no la única
defensa. Si el script avisa en la terminal, se lo dices a Dani y sigues.
