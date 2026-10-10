---
description: Ejecuta el flujo completo de una o varias fichas aprobadas de Vigía, en cola. Uso: /tarea 0004 o /tarea 0006 0007 0008
argument-hint: <número de ficha> [más números, en orden]
---

Fichas: `$ARGUMENTS` (una o varias, en ese orden). Eres el Orquestador: no escribes código ni
tests. Coordinas, vigilas el estado de cada ficha y escribes en ella lo que te devuelven los
subagentes. El detalle del flujo está en `docs/flujo.md`.

**Cola** (si hay más de un número; con uno solo, es lo mismo con una ficha):

- Las fichas se hacen una detrás de otra, en el orden dado, cada una entera (pasos 1 a 10) antes de
  empezar la siguiente, y cada una desde el `main` que dejó la anterior. El CI no se espera (paso
  10).
- Carril rápido (`ligera: sí`; ADR-0013): no espera detrás de las normales que aún no han empezado.
  Pasa delante en cuanto acaba la ficha en curso, sin interrumpirla. Si te llega una ficha nueva
  del carril rápido mientras trabajas, la pones la siguiente.
- **Si falla el CI de un push, se para la cola** (`docs/flujo.md`, "El CI, sin esperarlo"): no
  lanzas ningún subagente más y el que esté trabajando acaba su paso; su ficha queda `en_espera` en
  su rama. Después localizas la ficha culpable y relanzas el job que falló una sola vez. Si pasa,
  el spec queda en el BACKLOG como sospechoso de inestable (fecha y run, para la ficha B) y sigues.
  Si vuelve a fallar, reabres la culpable (`en_desarrollo`, rama `fix/NNNN-ci` desde `main`) y la
  llevas por developer, reviewer, verifier, doc-writer e integración antes de seguir. Si el arreglo se sale de su alcance, para y pregunta.
  Con dos intentos sin verde, `bloqueada` y **Aviso**. Con el CI en verde, retomas la que esperaba:
  rebase sobre `main` y, si toca algo más que documentos, repites su verifier.
- Antes de empezar una, mira su `depende_de`: si alguna de esas fichas no está `hecha`, se salta y
  se dice en el resumen final.
- Si una ficha se para esperando a Dani (`[ALCANCE]` no delegado o cualquier "para y pregunta"):
  apunta la pregunta en la ficha (`estado: en_espera`, con la pregunta en "Notas del revisor" o en
  "Resultado"), manda el **Aviso** de `parada`, deja su rama como está y sigue con la siguiente
  ficha que no dependa de ella. Cuando Dani responda, se retoma con `/tarea NNNN` (rebase de la rama
  sobre `main` y se sigue por donde iba).
- Si una ficha queda `bloqueada`, igual: **Aviso**, su rama se queda y se sigue con la siguiente.
- Al acabar la cola: un resumen para Dani (hechas, en espera con su pregunta, bloqueadas con el
  motivo, saltadas por dependencias) y el **Aviso** de la cola.

**Por cada ficha:**

1. Lee la ficha. Si su estado no es `aprobada` (o, al retomar, uno intermedio o `en_espera`), para
   y avisa. Si el árbol tiene cambios sin commitear, para y avisa.
2. `git switch -c <rama de la ficha> main` (o `git switch <rama>` si ya existe y retomas).
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
7. Con APROBADO, **verifier** en modo `ficha` con la rama, el rango `main..<rama>` y una carpeta de
   tu scratchpad. Copia su resultado en "Verificación". Si es ROJO, vuelve al developer con el
   fallo (cuenta como una ronda más) y repite la revisión. Si es VERDE: `estado: verificada`.
8. **doc-writer**, con la ruta de la ficha.
9. Integración (`docs/flujo.md`, "Git"): `git -C <checkout principal> merge --ff-only <rama>`. Si
   no es fast-forward, `git rebase main` en la rama y, si el rebase tocó algo más que documentos,
   repite el verifier. Después `git -C <checkout principal> push origin main` (el pre-push pasa
   `scan:tenant`) y borra la rama local.
10. Sondea el CI del push en segundo plano (`gh run list --branch main --limit 1`, si `gh` está
    disponible; si no, la API de GitHub) y **no lo esperes**: empieza ya la siguiente ficha de la
    cola. Cuando acabe el CI, muestra a Dani el briefing del doc-writer, más las rondas, el
    resultado del verifier y el enlace al CI, y manda el **Aviso** con `estado: hecha`. Si falla,
    ver "Si falla el CI" arriba. Un push que solo toca Markdown, `docs/`, `tasks/` o `.claude/` no
    lanza CI (`paths-ignore`).

**Medición** (solo si la ficha tiene `medir: sí`; `docs/flujo.md`, "Medición del flujo"):

- Pásale a cada subagente la instrucción: horas de `date "+%Y-%m-%d %H:%M:%S"`, nunca estimadas, y
  sus filas de «Pasos» y «Ejecuciones» en la respuesta (el doc-writer las escribe él).
- Toma la hora justo antes de lanzar cada subagente y al recibir su respuesta, para el arranque y la
  vuelta.
- Copia las filas en la ficha, junto con las tuyas: commits con su hook, merge, push y esperas.
- Los tiempos del CI salen del propio CI (jobs y pasos, sin logs). Sin rama propia: guárdalos y
  pásaselos al doc-writer de la ficha siguiente, que los añade a la ficha medida en su commit de
  cierre, con los totales. Si no queda ninguna detrás, un último commit de documentación al acabar
  la cola.
- Esa medición va en un commit de documentación, que no lanza otro CI.

No saltes pasos ni hooks. Si algo no está escrito en el repositorio y hace falta decidirlo, para y
pregunta (con el **Aviso** de `parada`).

**Aviso** (`docs/flujo.md`; opcional, nunca para el flujo): escribe un JSON en tu scratchpad y
ejecuta `node scripts/notify-telegram.mjs <ruta-del-json>`. Campos: `tipo: "tarea"`, `ficha`,
`titulo`, `estado`, `resumen`, `rondas`, `verifier` (`VERDE` | `ROJO` | `sin pasar`), `ci` y
`decision`. Cuándo:

- `estado: hecha`: tras el push del paso 9, con el enlace del CI del paso 10 en `ci`.
- `estado: bloqueada`: tres rondas sin aprobar (también si la última fue un ROJO del verifier), con
  el motivo en `resumen` y el último resultado en `verifier`.
- `estado: parada`: esperando a Dani (`[ALCANCE]` no delegado o cualquier "para y pregunta"), con la
  pregunta en `decision`, escrita para contestarla desde el móvil (sí/no u opciones numeradas).
- Fin de una cola de más de una ficha: `ficha` con el rango (`0006–0008`), `titulo: "Cola"`,
  `estado: hecha` si todas acabaron hechas o `parada` si alguna espera a Dani (con las preguntas en
  `decision`), y en `resumen` qué quedó en cada una.

El `resumen` lo redactas tú desde el briefing del doc-writer (o el motivo), en pocas líneas, sin
datos del tenant ni nombres de clientes: el filtro del script es la red de seguridad, no la única
defensa. Si el script avisa en la terminal, se lo dices a Dani y sigues.
