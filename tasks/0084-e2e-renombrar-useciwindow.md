---
id: '0084'
titulo: 'e2e: renombrar useCiWindow a applyCiWindow y quitar la excepción de lint rules-of-hooks'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: ideas-backlog # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0070'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: chore/0084-e2e-renombrar-useciwindow
adrs: [6] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

BACKLOG, «Mejoras anotadas» (surgió en 0021): «e2e: renombrar `useCiWindow` (empieza por «use» y
obliga a la excepción de lint `react-hooks/rules-of-hooks` en `e2e/**`) y quitar la excepción.
Cambia el texto del CA1 de la 0021: lo decide Dani». Dani dijo que sí el 2026-10-11.

## Especificación

- Renombrar `useCiWindow` (`e2e/window-size.ts`) a **`applyCiWindow`** (nombre propuesto por el
  Planificador: dice lo que hace, fijar la ventana del CI, y no empieza por «use»). Se cambian todas
  sus llamadas en `e2e/` (los specs y `e2e/views/harness.ts`), su mensaje de error, los comentarios
  y `e2e/CLAUDE.md` si lo nombra.
- Los tests que lo buscan por nombre pasan a buscar el nuevo: `scripts/e2e-ci-window.test.ts` (CA1
  de la 0021; su ayudante `isUseCiWindow` pasa a `isApplyCiWindow`) y
  `scripts/e2e-views-harness.test.ts` (CA2 de la 0069). El título de esos tests cambia solo en el
  nombre de la función.
- Quitar de `eslint.config.mjs` el bloque que apaga `react-hooks/rules-of-hooks` en `e2e/**/*.ts`.
  Comprobado por el Planificador el 2026-10-11: en `e2e/` no hay otra llamada que empiece por
  `use` (ni fixtures de Playwright con `use(...)`). Si al quitarla el lint falla por otra cosa, se
  para y se avisa: no se vuelve a poner la excepción.
- En la ficha 0021, una nota al final del CA1: «La 0084 renombró `useCiWindow` a `applyCiWindow`».
  No se reescribe el resto de esa ficha.
- Va después de la 0070, que parte `views.spec.ts` en varios specs (más llamadas que cambiar), para
  no chocar con su rama.
- Al cerrar, se quita la línea del BACKLOG.

## Carril

Rápido (`ligera: sí`): S, sin exclusiones, y cumple los cuatro puntos.

1. No añade componentes, funciones ni cálculos nuevos: se cumple; es un cambio de nombre.
2. No elimina nada visible para el usuario: se cumple; solo toca e2e, sus guardas y el lint.
3. No toca datos, API ni lógica: se cumple; no toca `src/`.
4. No hay ninguna decisión que preguntar a Dani: se cumple; Dani dijo que sí (2026-10-11) y el
   nombre es una decisión de diseño.

## Criterios de aceptación

- CA1: el CA1 de la 0021 (`scripts/e2e-ci-window.test.ts`) pasa buscando `applyCiWindow` justo
  después de cada arranque de la app, y un caso nuevo con «CA1 (0084)» en el nombre falla si algún
  fichero de `e2e/` sigue nombrando `useCiWindow`.
- CA2: un test unitario con «CA2 (0084)» en el nombre comprueba que `eslint.config.mjs` ya no apaga
  `react-hooks/rules-of-hooks` para `e2e/**`, y `npm run check` (lint incluido) pasa.
- CA3: el CA2 de la 0069 (`scripts/e2e-views-harness.test.ts`) pasa con `applyCiWindow`.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Que `isUseCiWindow` compruebe el argumento de la llamada (otra mejora anotada del BACKLOG, de la
  0021): sigue anotada.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
