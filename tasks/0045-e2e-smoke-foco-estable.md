---
id: '0045'
titulo: e2e estable del smoke «la ventana no le quita el foco»
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote:
depende_de: []
aprobada_por: peticiones (el Orquestador, por la delegación de Dani del 2026-10-09; ver la especificación)
rama: fix/0045-e2e-smoke-foco-estable
adrs: []
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 0
---

## Petición original

Sin petición de Dani: la abre el Orquestador, por la delegación de Dani mientras duerme, igual que
la 0044. El intermitente se apuntó en la 0044 y desde entonces ha salido en los e2e locales de los
developers de la 0032 y la 0033; si llega al CI, frena la cola.

## Especificación

El e2e `e2e/smoke.spec.ts` › «VIGIA_E2E: la ventana de la prueba se ve, pero no le quita el foco
del sistema a quien usa el PC» falla a veces con `visible: false` en
`expect(state).toEqual({ visible: true, focused: false })`, sobre todo con todos los e2e en
paralelo; solo, pasa.

Hipótesis a comprobar por el developer: con `VIGIA_E2E`, la ventana se enseña sin foco
(`showInactive` o similar) de forma asíncrona, y el test lee `isVisible()` antes de que llegue; o,
con carga, Windows tarda en reportarla visible. Arreglo preferido en el test: esperar con
`expect.poll` (tiempo acotado) a que `isVisible()` sea `true` y después comprobar que no tiene el
foco. Si la causa es de la app (la ventana de verdad no se enseña en algún caso), lo dice y se para:
eso sería otra ficha. No se suben timeouts globales ni se añaden `retries`.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): el test pasa 30 veces seguidas con `--repeat-each 30 --workers=1` y otras 30 con los
  workers por defecto, y en un e2e completo.
- CA2 (e2e): si la ventana tuviera el foco, el test sigue fallando (la espera solo cubre la
  visibilidad, no el foco).

## Pruebas a mano para Dani

(ninguna)

## Fuera de alcance

- Cambiar cómo la app enseña la ventana.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
