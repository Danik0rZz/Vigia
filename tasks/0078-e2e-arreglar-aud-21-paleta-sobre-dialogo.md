---
id: '0078'
titulo: 'e2e inestable: AUD-21, la paleta por encima de un diálogo abierto (tenants.spec.ts)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0076'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0078-e2e-aud-21-paleta-sobre-dialogo
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
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

- AUD-03 (0077) y los demás tests de `tenants.spec.ts`.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
