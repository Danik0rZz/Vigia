---
id: '0077'
titulo: 'e2e inestable: AUD-03, confirmación al cerrar con un secreto sin guardar (tenants.spec.ts)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0076'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0077-e2e-aud-03-secreto-sin-guardar
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

ADR-0013, parte 2, B: «una ficha de arreglo por cada uno». BACKLOG (surgió en 0064):
`e2e/tenants.spec.ts` es inestable a veces; AUD-03 (confirmación al cerrar con un secreto sin
guardar) falla con `--repeat-each 3`, y ya pasaba en `main`.

## Especificación

Test: `tenants.spec.ts`, «AUD-03: un secreto escrito sin guardar pide confirmación al cerrar».

**Si la 0076 no lo reproduce** (pasa todas sus tandas), esta ficha no se empieza: queda `en_espera`
y el Orquestador avisa al Planificador.

1. **Causa antes que arreglo.** Reproducirlo (`--repeat-each` hasta ver el fallo; `tenants.spec.ts`
   va en modo serie) y explicar en la ficha por qué falla: espera insuficiente en el test, una
   carrera en la app (por ejemplo, el aviso de «secretos sin guardar» se evalúa antes de que llegue
   el último carácter) o dependencia de un test anterior del modo serie. Nada de subir tiempos de
   espera sin causa.
2. **Arreglo donde está la causa.** Si es el test, se arregla el test con una espera a una condición
   de la interfaz (no un `waitForTimeout`). Si es la app, se arregla la app con su test unitario o
   e2e que lo demuestre; si el arreglo de la app cambia lo que ve el usuario o se sale de lo que hace
   hoy el diálogo, se para y se pregunta (`[ALCANCE]`).
3. **Fuera de cuarentena:** se quita `@inestable` y la anotación `arreglo`, y se quita de la sección
   «Tests en cuarentena» del BACKLOG.

El título del test no cambia (lleva el criterio de su ficha); si el cuerpo cambia mucho, se añade
«, arreglo (0077)» al final del título.

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
  con «(0077)» en el nombre.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Los otros tests de `tenants.spec.ts` (AUD-21 es la 0078).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
