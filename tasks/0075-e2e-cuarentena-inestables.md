---
id: '0075'
titulo: 'e2e: cuarentena de los tests inestables con la etiqueta @inestable (no bloquean y siguen a la vista)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0067', '0073'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0075-e2e-cuarentena-inestables
adrs: [6, 13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

ADR-0013, parte 2, B (aprobada por Dani el 2026-10-10): «localizar los specs intermitentes, ponerlos
en cuarentena con una etiqueta (no bloquean, pero siguen a la vista) y una ficha de arreglo por cada
uno».

## Especificación

Primera ficha del lote **e2e-inestables**: el mecanismo, sin poner ningún test en cuarentena (eso es
la 0076).

- **Etiqueta `@inestable`**, como etiqueta de recurso en `e2e/areas.json` (`resourceTags`, 0067).
  Cada test con `@inestable` lleva además una anotación de Playwright de tipo `arreglo` con el
  número de su ficha de arreglo en `description`.
- **Dos proyectos de Playwright** en `playwright.config.ts`: `e2e` (todo menos `@inestable`, con
  `grepInvert`) y `inestables` (solo `@inestable`, con `grep`). Las demás opciones, iguales.
- **Bloquea solo `e2e`:** `test:e2e`, `test:e2e:nobuild` y `test:e2e:affected` lanzan solo
  `--project=e2e`. Un script nuevo, `test:e2e:inestables`, lanza el otro proyecto; el verifier lo pasa
  y apunta el resultado en la ficha, pero un fallo ahí no lo pone en rojo.
- **En el CI de las PR** (tal como quede tras la 0073): el paso del e2e completo lanza `--project=e2e`
  (bloqueante) y un paso más lanza `--project=inestables` con `continue-on-error: true` y escribe en el
  resumen del job (`$GITHUB_STEP_SUMMARY`) cuántos pasaron y fallaron, con el título y la ficha de
  cada uno que falló. «CI ok» no depende de ese paso.
- **Specs en modo serie** (`tenants.spec.ts` usa `mode: 'serial'`): un test sacado por `grepInvert`
  no se ejecuta en `e2e`, así que los siguientes no pueden depender de lo que él dejaba. El developer
  lo comprueba en `tenants.spec.ts` y lo documenta en `e2e/CLAUDE.md`; si un test depende de otro, la
  0076 lo dice antes de poner ninguno en cuarentena.
- **Guarda** (en la de la 0067): un test con `@inestable` tiene la anotación `arreglo`; la ficha
  `tasks/NNNN-*.md` existe; y no está `hecha` (si está hecha, la etiqueta sobra y hay que quitarla).
- **A la vista:** una sección «Tests en cuarentena» en `BACKLOG.md` que el doc-writer mantiene (test,
  spec, ficha de arreglo, desde cuándo). La guarda no la lee; la regla va en `docs/flujo.md`.
- **Documentación:** `docs/flujo.md` («Niveles de prueba» y «El CI, sin esperarlo»: un fallo que pasa
  al relanzar se anota como sospechoso y, si se confirma, va a cuarentena con su ficha) y
  `e2e/CLAUDE.md`.

## Carril

Normal (`ligera: no`). Toca el CI (servicio externo).

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**, añade proyectos, un script y
   una regla de la guarda.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **no se cumple**, cambia qué tests bloquean.
4. No hay ninguna decisión que preguntar a Dani: se cumple.

## Criterios de aceptación

- CA1 (test de `scripts/` sobre la config): hay dos proyectos; `e2e` excluye `@inestable` y
  `inestables` solo la incluye.
- CA2: `test:e2e`, `test:e2e:nobuild` y el plan de `test:e2e:affected` usan `--project=e2e`;
  `test:e2e:inestables` usa `--project=inestables`.
- CA3: con specs de ejemplo, la guarda falla con un `@inestable` sin anotación `arreglo`, con una
  ficha que no existe o con una ficha `hecha`.
- CA4 (`scripts/ci-workflow.test.ts`): en las PR, el paso de inestables usa
  `--project=inestables`, tiene `continue-on-error: true` y escribe en `$GITHUB_STEP_SUMMARY`; el
  paso bloqueante usa `--project=e2e`; `ci-ok` no depende del de inestables.
- CA5: con un test de ejemplo marcado `@inestable` (en un spec de prueba fuera de `e2e/` o con un
  filtro), `--list` del proyecto `e2e` no lo incluye y el de `inestables` sí.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Poner tests concretos en cuarentena (0076) y arreglarlos (0077, 0078 y las que salgan).
- Reintentos automáticos (`retries` sigue a 0).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
