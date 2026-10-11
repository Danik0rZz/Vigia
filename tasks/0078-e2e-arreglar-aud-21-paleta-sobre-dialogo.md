---
id: '0078'
titulo: 'e2e inestable: AUD-21, la paleta por encima de un diálogo abierto (tenants.spec.ts)'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0076'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0078-e2e-aud-21-paleta-sobre-dialogo
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

ADR-0013, parte 2, B: «una ficha de arreglo por cada uno». BACKLOG (surgió en 0064):
`e2e/tenants.spec.ts` es inestable a veces; AUD-21 (paleta por encima de un diálogo) falla con
`--repeat-each 3`, y ya pasaba en `main`.

## Especificación

Test: `tenants.spec.ts`, «AUD-21: Ctrl+K con un diálogo abierto saca la paleta por encima y con el
foco».

**Si la 0076 no lo reproduce** (pasa todas sus tandas), esta ficha no se empieza: queda `en_espera`
y el Orquestador avisa al Planificador.

1. **Causa antes que arreglo.** Reproducirlo y explicar en la ficha por qué falla: por ejemplo, el
   foco que el diálogo (Radix) devuelve o atrapa después de abrir la paleta, el atajo pulsado antes de
   que el diálogo termine de abrirse, o el orden de las capas mientras dura una animación. Nada de
   subir tiempos de espera sin causa.
2. **Arreglo donde está la causa.** Si es el test, una espera a una condición de la interfaz (diálogo
   abierto y con el foco dentro antes del atajo; paleta visible y con el foco después), no un
   `waitForTimeout`. Si es la app (la paleta no queda siempre por encima o pierde el foco), se arregla
   la app con su test; si cambia lo que ve el usuario, se para y se pregunta (`[ALCANCE]`).
3. **Fuera de cuarentena:** se quita `@inestable` y la anotación `arreglo`, y se quita de la sección
   «Tests en cuarentena» del BACKLOG.

El título del test no cambia; si el cuerpo cambia mucho, se añade «, arreglo (0078)» al final.

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: no se sabe hasta conocer la causa (en la duda,
   no).
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **puede no cumplirse**, si la causa está en la app.
4. No hay ninguna decisión que preguntar a Dani: se cumple, salvo el `[ALCANCE]` del punto 2.

## Criterios de aceptación

- CA1: el test pasa 10 de 10 con `--repeat-each 10` en su spec, con los workers de siempre, y 10 de
  10 con el spec entero y `--workers=1`.
- CA2: el test ya no tiene `@inestable` y la guarda de la 0075 sigue en verde.
- CA3: si la causa estaba en la app, un test (unitario o e2e) que falla sin el arreglo y pasa con él,
  con «(0078)» en el nombre.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Se retoma el 2026-10-11 con la condición de Dani cumplida (AUD-21 visto fallar de nuevo en el e2e afectado de la 0077; ver «Resultado»). AUD-21 no llegó a ponerse en cuarentena (0076): el punto de quitar `@inestable` no aplica, igual que en la 0077. `exclusiones: []`, decidido por Dani.

- AUD-03 (0077) y los demás tests de `tenants.spec.ts`.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- Causa confirmada en el código de Radix instalado (`@radix-ui/react-dismissable-layer` 1.1.19, la de `package-lock.json`, `dist/index.mjs` líneas 41-52, 108-118 y 147): en el primer render la capa aún no está registrada y, con el formulario modal en `layersWithOutsidePointerEventsDisabled`, el contenido se pinta con `pointer-events: none` hasta que el `useEffect` la registra y vuelve a pintar. En ese fotograma `elementFromPoint` da `onTop` falso (línea 850). Orden de capas correcto: z-[60] en overlay y contenido (`CommandPalette.tsx:39-43`).
- No es un defecto de la app ni `[ALCANCE]`: a la vista la paleta está encima desde el primer fotograma; solo un clic en los ~10 ms tras Ctrl+K iría al fondo, y es comportamiento de la librería. CA3 no aplica.
- Los `expect.poll` (`e2e/tenants.spec.ts:847-859`) esperan a condiciones de la interfaz (centro de la paleta y foco dentro); si la paleta quedara debajo o sin foco, fallaría al agotar la espera. Sin `waitForTimeout`; título y etiqueta (`@tenants`) sin cambios.
- Diff: solo el bloque de AUD-21 y la ficha. Sin código de producción, IPC, API, dependencias, esquema ni datos del tenant.

## Verificación

Test-writer (2026-10-11): no se escriben tests antes de conocer la causa; ningún criterio se puede
escribir hoy como un test que falle por falta de código (AUD-21 ya existe y pasa casi siempre).

- CA1 es una medición, no un test nuevo. La hace el verifier (y el developer antes de entregar),
  siempre con el spec entero (`tenants.spec.ts` va en modo serie; con `-g` no vale):
  `npm run test:e2e:nobuild -- e2e/tenants.spec.ts --repeat-each 10` con los workers de siempre
  (AUD-21 10 de 10) y `npm run test:e2e:nobuild -- e2e/tenants.spec.ts --workers=1 --repeat-each 10`
  (AUD-21 10 de 10).
- CA2 ya se cumple hoy y debe seguir así: AUD-21 lleva solo `{ tag: '@tenants' }` (sin
  `@inestable` ni anotación `arreglo`; nunca entró en cuarentena) y
  `npx vitest run scripts/e2e-tags.test.ts` pasa. Lo comprueba el verifier.
- CA3 depende de dónde esté la causa. Si está en la app (la paleta no queda siempre por encima del
  diálogo o pierde el foco), el developer escribe el test que lo demuestra (unitario junto al
  componente o e2e en `tenants.spec.ts`, con «(0078)» en el nombre) y el verifier comprueba que
  falla sin el arreglo (revirtiendo solo el cambio de producción) y pasa con él. Si la causa está en
  el test (atajo antes de que el diálogo termine de abrirse, comprobación durante una animación),
  CA3 no aplica y la ficha lo dice en «Resultado».

Verificación 2026-10-11, commit 112f01a, rango `integra/20261011-3..fix/0078-e2e-aud-21-paleta-sobre-dialogo`: **VERDE**.

- `npm run check`: 211 ficheros, 3692 tests; cobertura: líneas 93,43 %, ramas 89,98 %.
- e2e afectados, un pase: 42 pasados (12,5 s), AUD-21 incluido.
- CA1: `e2e/tenants.spec.ts` entero, sin `-g`, `--repeat-each 10`: con 4 workers, 270 pasados (30 s); con `--workers=1`, 270 pasados (1,8 min). 27 tests × 10: AUD-21 10 de 10 en las dos.
- CA2: AUD-21 sigue solo con `@tenants`; `scripts/e2e-tags.test.ts` 20 de 20.
- CA3: no aplica (la causa estaba en el test).

## Resultado

En espera (decisión de Dani, 2026-10-11): AUD-21 no se reprodujo en la medición de la 0076 (12 de 12 en verde). Se retoma cuando el CI o una medición vuelva a verlo fallar.

Visto fallar de nuevo (2026-10-11, en la 0077): AUD-21 falló una vez en el e2e afectado del developer de la 0077 (entre 10:01:18 y 10:01:29, línea 850, `onTop` falso: en el centro de la paleta no está la paleta), con el mismo `out/` con que pasó 20 de 20 en las tandas de CA1; el verifier no lo vio fallar. La condición de Dani para retomar la 0078 se cumple.

Causa (developer, 2026-10-11): está en el test, no en la app. Al abrirse la paleta con el
formulario modal ya abierto, `DismissableLayer` de Radix (1.1.19) pinta su capa la primera vez con
`pointer-events: none`: calcula su posición en la pila de capas con un `node` que aún no está
registrado (lo añade un `useEffect` y lo repinta con un `force({})` posterior). Visualmente la
paleta ya está encima (z-60 frente a z-40/50), pero `elementFromPoint` se salta lo que tiene
`pointer-events: none` y devuelve el fondo de la paleta (que Radix deja en `auto`), fuera de su
contenido: `onTop` falso. Medido con una traza temporal (no commiteada) en AUD-21: primera mutación
a los ~10 ms con `pe=none onTop=false`, pasa a `pe=auto onTop=true` a los ~19 ms; un fotograma.
Si `toBeVisible` y la lectura caen dentro de ese fotograma, falla. Para el usuario no hay nada
visible (solo un clic en ese mismo fotograma iría al fondo), así que no hay `[ALCANCE]` ni CA3.

Arreglo: AUD-21 espera con `expect.poll` a las dos condiciones (centro de la paleta es la paleta;
foco dentro de la paleta, que también mueve un efecto de `FocusScope`). Sin `waitForTimeout` ni
tiempos subidos. El cuerpo cambia poco: el título se queda igual.

- CA1: `e2e/tenants.spec.ts --repeat-each 10` (workers de siempre) 270 de 270, AUD-21 10 de 10
  (10:21:27–10:21:57); con `--workers=1 --repeat-each 10`, 270 de 270 (10:22:01–10:23:48).
- CA2: AUD-21 sigue solo con `{ tag: '@tenants' }`; nunca estuvo en cuarentena.
- CA3: no aplica (la causa está en el test).

Cierre (doc-writer): commits 9758820 (test), 46ec732, 112f01a y 20d07b5 (fichas); fichero principal `e2e/tenants.spec.ts` (solo el bloque de AUD-21). Una ronda de revisión (APROBADO), sin ADR nuevo, sin migraciones. Lección anotada en `e2e/CLAUDE.md`.
