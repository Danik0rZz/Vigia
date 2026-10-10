---
id: 'NNNN'
titulo:
estado: borrador # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/NNNN-slug
adrs: [] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Lo que pidió Dani, con sus palabras (sin datos del tenant ni nombres de clientes).

## Especificación

Qué se construye y las decisiones tomadas con Dani (o por peticiones en su nombre, con el motivo).
Endpoints, parámetros y scopes, con la referencia a la OpenAPI de `..\API\` o a la documentación
oficial: nada inventado.

## Carril

Rápido (`ligera: sí`) solo si se cumplen todos; si falla uno, normal. Justificar cada punto:

1. No añade componentes, funciones ni cálculos nuevos:
2. No elimina nada visible para el usuario:
3. No toca datos, API ni lógica:
4. No hay ninguna decisión que preguntar a Dani:

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1:

## Pruebas a mano para Dani

Lo que solo se ve con datos reales o en el zip. No son criterios: van a `docs/pendiente-dani.md` al
cerrar la versión.

-

## Fuera de alcance

-

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
