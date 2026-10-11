---
id: '0099'
titulo: Auto-merge de GitHub en las PR de una ficha sola que fusiona Dani
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0099-auto-merge-pr-de-dani
adrs: ['0013', '0014'] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Petición del Orquestador (2026-10-11), con la decisión de Dani: para no ser el cuello de botella,
en las PR de una ficha con exclusiones (van solas y las fusiona él) se usa el auto-merge de GitHub.
Dani ya ha activado «Allow auto-merge» en la configuración del repositorio (comprobado con la API:
auto-merge permitido, merge commit permitido y borrado de la rama al fusionar activo).

Procedimiento acordado:

1. El Orquestador abre la PR y avisa a Dani en ese momento (sesión y Telegram), sin esperar al CI.
2. Dani pulsa «Enable auto-merge» con «Create a merge commit». GitHub la fusiona sola cuando «CI ok»
   sale en verde.
3. El Orquestador vigila la PR. Cuando pasa a `MERGED`, hace «Traer `main`» y sigue, sin que Dani
   tenga que escribir «fusionada». Si el CI falla, se aplica «Si falla el CI» como siempre.

El Orquestador nunca activa el auto-merge por su cuenta en las PR de Dani: la fusión de esas PR
sigue siendo de Dani. Las PR agrupadas sin exclusiones no cambian.

## Especificación

Solo documentación del flujo y sus tests de texto. Sin código de la app ni configuración.

**Dónde va:**

- `docs/flujo.md`, sección «Git», viñeta «PR de una ficha sola»: el procedimiento de arriba, en
  tres pasos. Y en «Quién decide» → «Solo lo decide Dani», junto a «fusionar la PR de una ficha
  sola», que lo hace activando el auto-merge en GitHub (la decisión sigue siendo suya).
- `.claude/commands/tarea.md`:
  - Paso 9 (abrir la PR de una ficha sola): el **Aviso** de `parada` sale al abrir la PR, sin esperar
    al CI, con el enlace de la PR en `ci` y en `decision` que active «Enable auto-merge» con «Create
    a merge commit» (no «Squash» ni «Rebase»).
  - Paso 10: para la PR de una ficha sola, el Orquestador la sondea en segundo plano con
    `gh pr view <número> --json state` hasta que sale `MERGED`; entonces «Traer `main`», las fichas
    que dependían de ella dejan de estar `en_espera`, y el **Aviso** de `hecha` de esa ficha. No hace
    falta que Dani escriba «fusionada». Si el CI de esa PR falla, «Si falla el CI» como siempre: el
    `fix(…)` va a la misma `integra/…`, y el auto-merge que activó Dani sigue activo y fusiona cuando
    el commit nuevo pasa «CI ok» (si GitHub lo hubiera desactivado, se avisa a Dani para que lo
    vuelva a activar).
  - Sección **Aviso**, `estado: parada` al abrir la PR de una ficha sola: `decision` con el
    auto-merge, en vez de «que la fusione él».
  - Regla explícita: el Orquestador **nunca** usa `gh pr merge … --auto` ni activa el auto-merge por
    otra vía en ninguna PR; en las agrupadas sigue fusionando él con
    `gh pr merge <número> --merge --match-head-commit <sha>` (sin cambios).
- `scripts/integration-docs.test.ts`: los tests de los criterios. Ojo: el test «CA1 (0090)» exige
  que todo fragmento de código de `tarea.md` que empieza por `gh pr merge` sea
  `gh pr merge <n> --merge --match-head-commit <sha>`. La prohibición de `--auto` se escribe en
  prosa, sin poner `gh pr merge … --auto` entre comillas invertidas (o el 0090 falla).

**No se toca:** el `CLAUDE.md` raíz (su regla «fusionar la PR de una ficha sola» sigue siendo de
Dani y sigue siendo cierta), el ADR-0014 (su punto 4, «esa PR la fusiona Dani», sigue siendo cierto),
`.claude/settings.json` y `scripts/integrate.mjs` (el agrupado no cambia).

## Carril

Normal (`ligera: no`). Sin exclusiones: solo cambia documentos del flujo y un test de texto; no toca
`.claude/settings.json`, permisos, secretos, la API de Dynatrace ni la configuración de GitHub (eso
ya lo hizo Dani).

1. No añade componentes, funciones ni cálculos nuevos: cumple en la app (no la toca); los tests de
   texto pueden reutilizar `codeSpans` y `normalize`.
2. No elimina nada visible para el usuario: cumple.
3. No toca datos, API ni lógica: **en duda**. No es código, pero cambia el procedimiento del
   Orquestador para fusionar las PR con exclusiones, que es una puerta del flujo (quién fusiona qué).
   Por la regla de «en la duda, no», va por el carril normal, con test-writer.
4. No hay ninguna decisión que preguntar a Dani: cumple; el procedimiento lo decidió Dani el
   2026-10-11.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1: `docs/flujo.md` (sección «Git») y `.claude/commands/tarea.md` cuentan que en la PR de una
  ficha sola Dani activa el auto-merge («Enable auto-merge» con «Create a merge commit») y que
  GitHub la fusiona cuando «CI ok» sale en verde. Test de texto en `scripts/integration-docs.test.ts`.
- CA2: ningún documento de `.claude/` ni `docs/flujo.md` tiene un fragmento de código
  `gh pr merge` con `--auto`, y `tarea.md` dice que el Orquestador nunca activa el auto-merge.
  Test de texto con su propia comprobación (un caso que lo detecte y otro que lo acepte en prosa).
- CA3: `tarea.md` sondea la PR de una ficha sola con `gh pr view <número> --json state` (fragmento
  de código que empieza así) y, al salir `MERGED`, hace «Traer `main`» sin esperar a que Dani diga
  que está fusionada. Test de texto.
- CA4: en la sección **Aviso** de `tarea.md`, el `parada` de la PR de una ficha sola sale al abrir la
  PR, sin esperar al CI, y su `decision` pide activar el auto-merge. Test de texto.
- CA5: los tests de la 0073 y la 0090 de `scripts/integration-docs.test.ts` siguen en verde
  (`npm run check`).

## Pruebas a mano para Dani

- Una vez, en Settings › Branches (o Rulesets) de `main`: comprobar que «CI ok» es un check
  obligatorio. El auto-merge espera a los checks obligatorios; si «CI ok» no lo fuera, GitHub
  fusionaría la PR sin esperarlo. El token de `gh` no puede leer la protección (403), por eso lo
  mira Dani. (Añadido el 2026-10-11, a raíz de la consulta al Orquestador.) **Confirmado por
  Dani el 2026-10-11:** «CI ok» es check obligatorio.
- En la próxima ficha con exclusiones (por la cola, la 0091): recibir el aviso al abrir la PR,
  activar «Enable auto-merge» con «Create a merge commit» y comprobar que GitHub la fusiona sola con
  «CI ok» en verde y que el Orquestador sigue sin que escribas «fusionada».

## Fuera de alcance

- Una regla `deny` (o un hook) que impida a los agentes `gh pr merge --auto`: tocaría
  `.claude/settings.json` (exclusión `seguridad`, PR sola). Hoy queda como regla escrita; si Dani lo
  quiere, ficha propia, junto al hook `PreToolUse` ya anotado de la 0082.
- Auto-merge en las PR agrupadas: no cambian (las fusiona el Orquestador atado al SHA, ficha 0090).
- El `CLAUDE.md` raíz, el ADR-0014 y `scripts/integrate.mjs`.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
