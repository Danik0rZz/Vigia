# ADR-0013: Carril rápido, menos repeticiones y no esperar al CI

Estado: aceptado (2026-10-10). Fichas de referencia: 0065 y 0066 (medición del flujo)

## Contexto

Dani pidió medir el flujo completo en dos cambios pequeños. La 0065 (cambiar un título) tardó
66 min 52 s de la petición al CI en verde, y la 0066 (un marcador nuevo) 107 min 13 s. El cambio en
sí eran segundos; el resto era coste fijo:

- **Cola:** 28 min (0065) y 54 min (0066) esperando a que acabaran las fichas anteriores. En la
  0065, 23 de esos minutos eran el verifier de la 0064, que pasó el e2e completo dos veces.
- **e2e repetidos:** el developer y el verifier pasaban los mismos e2e afectados (unos 5 min cada
  pase, con la compilación dentro). En la 0066 hubo cinco pases.
- **Afectados demasiado anchos:** tocar `locales/` dispara shell, smoke y views: 301 tests por un
  título.
- **CI:** 13 a 14 min por push (check 3 min, e2e completo 7 min, `dist:win` 2,5 min), y el
  Orquestador lo esperaba antes de seguir.
- **Playwright:** 4 workers con un spec por worker (sin `fullyParallel`). `views.spec.ts` tiene unos
  280 de los ~360 tests, así que corre en un solo worker y marca el tiempo de toda la tanda: subir
  los workers apenas ahorra. Lo que ahorra es partirlo por zonas (parte 2).

También se vio que la 0066 se marcó como ligera y no lo era: añadía una función nueva
(`availabilityLevel`) y un componente.

## Decisión

Aprobado por Dani el 2026-10-10. Esta es la **parte 1**: reglas del flujo, sin cambios de código.
Lo que necesita código va en la parte 2 (abajo), con fichas y revisión. Cada regla dice qué se hace
**desde hoy**, aunque la herramienta definitiva todavía no exista.

- **Carril rápido** (`ligera: sí`; el campo se llama igual para no romper las fichas anteriores).
  Además de lo de antes (S y sin canales IPC, API de Dynatrace, dependencias, esquema, seguridad ni
  servicios externos), tiene que cumplir **todos** estos puntos:
  1. No añade componentes, funciones ni cálculos nuevos.
  2. No elimina nada visible para el usuario.
  3. No toca datos, API ni lógica.
  4. No hay ninguna decisión que preguntar a Dani.

  Si falla uno, va por el carril normal. El Planificador lo justifica punto por punto en la ficha
  (sección «Carril»). El reviewer comprueba que el diff respeta esa clasificación; si no, lo dice y
  se anota para afinar el criterio (la ficha sigue, porque sus tests ya están revisados).

- **Cola:** una ficha del carril rápido no espera detrás de las normales que aún no han empezado:
  pasa delante en cuanto acaba la ficha en curso. Hacerla a la vez que otra necesita paralelismo
  (parte 2, ficha C); hasta entonces, no se interrumpe la ficha en curso.
- **Developer:** mientras desarrolla, solo los e2e de su ficha. Desde hoy:
  - compila una vez con `npm run build` y lanza
    `npm run test:e2e:nobuild -- <spec> -g "(NNNN)"`;
  - vuelve a compilar solo si cambia algo fuera de `e2e/` (los e2e corren sobre `out/`, ADR-0006);
  - tras un arreglo, solo lo que falló: `--last-failed`;
  - nunca repite una tanda si el código no ha cambiado.

  Termina con `npm run check` y, una sola vez, los specs de las zonas cuyo código fuente ha
  modificado, según `e2e/areas.json` (`npm run test:e2e:affected -- main..HEAD`). No los de los
  tests que ha tocado: una regresión aparece en un spec que no se ve venir, como el centrado de la
  0012 en la 0066. Hoy cada zona es un spec entero, así que ese pase cuesta lo mismo que el del
  verifier; se abarata al partir `views.spec.ts` (parte 2). Si aun así se escapa algo, lo encuentra
  el verifier.

- **Verifier:** un único pase de `npm run test:e2e:affected -- <rango>`. No repite lo que ya está en
  verde para el mismo commit. Las repeticiones ×3 solo en specs concretos sospechosos de ser
  inestables: uno que falló una vez, uno anotado como inestable en el BACKLOG, o uno cuyo diff toca
  temporización. Tras un arreglo hay un commit nuevo, y se le hace su pase normal.
- **Afectados:** hasta que existan las etiquetas por zona (parte 2), se usa la selección actual de
  `e2e/areas.json` sin cambios.
- **No se espera al CI** para empezar la siguiente ficha. El Orquestador lo sondea en segundo plano
  y manda el aviso de la ficha cuando acaba, con el enlace.
- **Si falla el CI, se para la cola:**
  1. No se lanza ningún subagente más. El que esté trabajando acaba su paso (no se corta a medias)
     y su ficha se queda en su rama, `en_espera`.
  2. El Orquestador localiza la ficha culpable. Hoy cada push es una ficha. Si el run cubre varias
     (GitHub cancela el que esperaba cuando llega un tercer push, BACKLOG 0056), se busca por el
     test que falla y el diff de cada una; en la duda, el verifier pasa ese spec en el commit de
     cada ficha.
  3. Se relanza el job que falló una sola vez. Si pasa, el spec queda anotado en el BACKLOG como
     sospechoso de inestable, con la fecha y el run, para la ficha B (así la cuarentena tiene datos
     reales), y la cola sigue.
  4. Si vuelve a fallar, se reabre la ficha culpable (`en_desarrollo`, rama `fix/NNNN-ci` desde
     `main`): developer con el fallo, reviewer, verifier, el doc-writer lo añade a «Resultado» y se
     integra. Si el arreglo se sale del alcance de la ficha, se para y se pregunta. Dos intentos
     sin verde: `bloqueada`, con su aviso.
  5. Con el CI en verde, la cola sigue: la ficha que esperaba se rebasa sobre `main` y, si el rebase
     toca algo más que documentos, se repite su verifier.
- **Medición** (solo en las fichas con `medir: sí`; Dani decide cuáles):
  - las horas salen de `date "+%Y-%m-%d %H:%M:%S"`, nunca estimadas;
  - los tiempos del CI se leen del propio CI (la API de GitHub o `gh run view`: inicio y fin de
    cada job y de cada paso, sin copiar logs) y se guardan en la ficha;
  - se desglosa el tiempo del Orquestador y el **arranque de cada subagente**: la hora que toma el
    Orquestador justo antes de lanzarlo frente a la del primer comando del subagente;
  - la medición va en el commit de documentación; los commits que solo tocan `tasks/`, `docs/` o
    Markdown no disparan el CI (`paths-ignore` de `ci.yml`), así que nunca provocan otro run. Si un
    commit de medición tuviera que ir con código, lleva `[skip ci]`;
  - como el CI no se espera, sus horas llegan cuando la ficha ya está en `main`. No llevan rama
    propia: el doc-writer las acumula y las añade a la ficha medida en el siguiente commit de
    documentación (el cierre de la ficha siguiente), con los totales. Si no queda ninguna ficha
    detrás, van en un último commit de documentación al acabar la cola.

## Parte 2 (con fichas, después de la 1)

Se piden al Planificador en este orden, y la C no empieza hasta medir el efecto de la A:

- **A, herramientas:**
  - etiquetas de los e2e por zona de la app, con un test que falle si algún spec o test queda sin
    etiqueta;
  - que un cambio solo en `locales/` lance los unitarios de textos y los e2e de su zona;
  - partir `views.spec.ts` por zonas (los tests del portapapeles, juntos y en serie) y medir con
    más workers;
  - `test:e2e:affected` con opción de no compilar y de pasar `-g` y `--last-failed`.
  - **Git y CI:**
    - un commit por ficha (agrupado al fusionar);
    - push a la rama sin CI, con el CI solo en PR a `main` agrupando 3 a 5 fichas (las del carril
      normal, en su propia PR), y el **e2e completo siempre en el CI de cada PR**: es la red de
      seguridad si la selección local falla;
    - `dist:win` solo al fusionar en `main` o al cerrar versión;
    - la medición automática (los tiempos del CI, con un script del repositorio).

  Cambiar la regla de push (hoy, solo `git push origin main`) y cómo se borran las ramas remotas lo
  decide Dani.

  **Antes de proteger `main`** (exigir el CI en verde para fusionar): el CI ignora los cambios que
  solo tocan documentos (`paths-ignore`). Con la protección activa, una PR solo de `docs/` o
  `tasks/` no lanzaría el CI, y el check obligatorio se quedaría «pendiente» para siempre: la PR no
  se podría fusionar. Es una trampa conocida de GitHub. Se resuelve con un job mínimo que se ejecuta
  siempre, sin `paths-ignore`, y que es el único que exige la protección. Ese job da verde cuando
  el resto del CI no aplica y espera a su resultado cuando sí. La otra opción, que los documentos
  viajen siempre dentro de la PR del lote, depende de que nadie se equivoque. La ficha A elige una
  y la deja probada antes de activar la protección.

- **B, tests inestables:** localizar los specs intermitentes, ponerlos en cuarentena con una
  etiqueta (no bloquean, pero siguen a la vista) y una ficha de arreglo por cada uno. La lista sale
  de datos reales: los anotados en el BACKLOG (hoy, AUD-03 y AUD-21 de `tenants.spec.ts`) y los
  sospechosos que dejen los fallos del CI que pasan al relanzar el job.
- **C, paralelismo:**
  - cada ficha declara `depende_de` y las zonas o ficheros que toca, y solo se paralelizan fichas sin
    dependencias ni zonas comunes;
  - cada una en su worktree, como mucho dos a la vez al principio;
  - el BACKLOG y el CHANGELOG sin conflictos: entradas por ficha (`changelog.d/NNNN.md`) o el
    doc-writer en `main` después del merge.
- **Medición de control:** tras la A, dos cambios equivalentes a la 0065 y la 0066, con `medir: sí`.
  Objetivo: que un cambio como la 0065 baje de 67 min a 10-15.

## Alternativas descartadas

- **Quitar el verifier o el reviewer en el carril rápido:** el reviewer tardó menos de un minuto en
  las dos fichas y el verifier es la única prueba en un árbol limpio. El coste estaba en las
  repeticiones y en la cola, no en las puertas.
- **Solo subir los workers de Playwright:** `views.spec.ts` sigue en un worker; sin partirlo, no
  ahorra.
- **Paralelizar ya:** sin `depende_de` y zonas en cada ficha, dos fichas a la vez chocan en el
  BACKLOG, el CHANGELOG y los mismos specs (pasó al integrar la 0064). Va en la C, después de medir.

## Consecuencias

Mientras `views.spec.ts` no se parta, el pase final del developer (las zonas de su código) cuesta
lo mismo que el del verifier. Lo que se ahorra desde hoy está en la iteración (solo los e2e de la
ficha, sin compilar de más y con `--last-failed`) y en que el verifier no repite. Si al developer
se le escapa una regresión, la encuentra el verifier y cuesta una ronda: se acepta.

No esperar al CI deja trabajo en marcha cuando llega un fallo. Por eso la regla de parar la cola y
arreglar la culpable antes de seguir.
