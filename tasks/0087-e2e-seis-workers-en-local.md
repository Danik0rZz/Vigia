---
id: '0087'
titulo: 'e2e: volver a 6 workers en local'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables-2 # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: chore/0087-e2e-seis-workers-en-local
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Dani, por el Orquestador (2026-10-11), decisión delegada en el Orquestador («la mejor opción que
creas»): volver a 6 workers en local. En la medición de la 0070, 6 workers daban 96-102 s frente a
85 s con 8, y desde que hay 8 han subido los fallos de tiempos en local.

## Especificación

- `playwright.config.ts`: `LOCAL_WORKERS` pasa de 8 a 6. Con `CI` siguen 4. El comentario de
  `LOCAL_WORKERS` dice por qué 6 y no el más rápido: con 8 subieron los fallos de tiempos (tooltips,
  tamaño de ventana) con la suite en paralelo; 6 cuesta unos 10-15 s más por pase (medición de la
  0070, en su «Verificación»).
- `scripts/playwright-workers.test.ts`: el test de la 0070 «sin CI, el número medido (4, 6, 8 o 10)»
  pasa a exigir 6 exactamente, con «(0087)» en el nombre. Los otros dos (con `CI`, 4; `workers`
  depende de `process.env.CI`) no cambian.
- `e2e/CLAUDE.md`, punto «Workers»: 4 en el CI y 6 en local (ficha 0087; con 8, más fallos de
  tiempos).
- Al cerrar (doc-writer): en el BACKLOG, la línea de «Sospechosos de inestables» quita la frase «Desde
  la 0070 (8 workers en local)… conviene que la ficha B lo mida» y apunta que se volvió a 6 en la
  0087; los sospechosos se quedan anotados, con los dos del CI de la PR #12 (run 38152066082, intento
  1): `views-problemas.spec.ts` «grid de Problemas: ARIA…» (no aparece el tooltip «Cerrado») y
  `views-problema-detalle.spec.ts` «v0.10.2: evidencia de 45 días…» (no aparece el tooltip con la
  fecha). En el CI ya eran 4 workers: esos dos no los explica esta ficha.

## Carril

Rápido (`ligera: sí`): S, sin canales IPC, API de Dynatrace, dependencias, esquema, seguridad ni
servicios externos.

1. No añade componentes, funciones ni cálculos nuevos: se cumple; cambia una constante, su
   comentario, un test que ya existe y una nota.
2. No elimina nada visible para el usuario: se cumple; solo afecta a cómo se lanzan los e2e en local.
3. No toca datos, API ni lógica: se cumple; es configuración de las pruebas, no de la app.
4. No hay ninguna decisión que preguntar a Dani: se cumple; Dani la delegó y el Orquestador eligió 6.

## Criterios de aceptación

- CA1: sin `CI`, `playwright.config.ts` da 6 workers (test de `scripts/playwright-workers.test.ts`
  con «CA1 (0087)» en el nombre).
- CA2: con `CI` siguen 4 y `workers` sigue dependiendo de `process.env.CI` (los dos tests de la 0070,
  sin cambiar).

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Los workers del CI.
- Arreglar los tests sospechosos (cada uno, su ficha si se confirma); el de la cola de gráficos es la 0086.
- Volver a medir los workers: la medición de la 0070 vale.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
