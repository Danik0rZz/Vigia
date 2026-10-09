---
id: '0044'
titulo: e2e estable del tooltip del menú plegado
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote:
depende_de: []
aprobada_por: peticiones (el Orquestador, por la delegación de Dani del 2026-10-09; ver la especificación)
rama: fix/0044-e2e-tooltip-menu-estable
adrs: []
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 0
---

## Petición original

Sin petición de Dani: la abre el Orquestador. Dani delegó las decisiones mientras duerme («Si hay
que tomar decisiones, las tienes que tomar tú») y el test inestable frena la cola: cada CI rojo
obliga a relanzar antes de integrar la siguiente ficha.

## Especificación

El e2e `e2e/shell.spec.ts` › «maquetación del menú: icono y nombre en la misma fila, desplegado y
plegado; el activo se distingue» falló dos veces en el CI de `main` en la línea
`await expect(tooltip).toBeVisible()` tras `hoverFresh(page, page.getByTestId('nav-problems'))`,
con el menú recién plegado (run 37733715700, intento 1, push de la 0027; run 37861610406, intento
1, push de la 0037). Relanzado, pasó las dos veces; en local no falla.

Hipótesis a comprobar por el developer: al plegar el menú hay una transición de anchura; el hover
llega al centro del enlace mientras aún se mueve (o Radix aún no tiene el disparador en su sitio) y
el tooltip no se abre, o se abre y se cierra. Arreglo en el test o en `e2e/hover.ts`, no en la app:
esperar a que el menú esté quieto (por ejemplo, que la anchura del `aside` o la caja del enlace no
cambie entre dos lecturas) antes del hover, y, si no basta, reintentar el hover con
`expect.toPass` en un tiempo acotado. No se suben timeouts globales ni se añaden reintentos a
Playwright (`retries`). Si el developer encuentra que la causa es de la app (el tooltip no sale de
verdad tras plegar), lo dice y se para: eso sería otra ficha.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): el test del menú (o el bloque del tooltip, si se separa con su número) pasa 30 veces
  seguidas con `--repeat-each 30 --workers=1` y otras 30 con la ventana del CI y `--workers` por
  defecto.
- CA2 (e2e): el resto de `e2e/shell.spec.ts` y los e2e que usan `hoverFresh` siguen en verde.

## Pruebas a mano para Dani

(ninguna)

## Fuera de alcance

- Cambiar el comportamiento del tooltip o del menú en la app.

## Reproducción (developer)

- Con el test tal cual, 30 de 30 en verde en local (`--repeat-each 30 --workers=1`): en local no
  falla.
- Medido en el test: `hoverFresh` lee la caja del enlace unos 85 ms después del clic en
  `sidebar-toggle`, con el `aside` aún a unos 110 px de los 56 finales (la transición de anchura dura
  200 ms). En local, el centro leído a esa anchura aún cae dentro del enlace plegado; si en el runner
  la lectura llega antes, cae fuera.
- Reproducción determinista: leer la caja de `nav-problems` justo tras el clic (222 px de ancho) y
  llevar el ratón a su centro deja el puntero a unos 128 px, fuera del menú ya plegado: el tooltip no
  sale (5 de 5 fallan). La causa es del test, no de la app: con el puntero dentro del enlace, el
  tooltip sale.
- Arreglo en `e2e/hover.ts`: `hoverFresh` y `moveToNeutral` leen la caja con `stableBox`, que espera
  a que no cambie entre dos lecturas separadas 50 ms (máximo 3 s). Con él, la misma reproducción
  (hover justo tras plegar) pasa 10 de 10. No hizo falta `expect.toPass`.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
