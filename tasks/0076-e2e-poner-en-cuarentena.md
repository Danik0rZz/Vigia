---
id: '0076'
titulo: 'e2e: medir los sospechosos de inestables y poner en cuarentena los que fallan'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0075'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0076-e2e-poner-en-cuarentena
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

ADR-0013, parte 2, B (aprobada por Dani el 2026-10-10): «la lista sale de datos reales: los anotados
en el BACKLOG (hoy, AUD-03 y AUD-21 de `tenants.spec.ts`) y los sospechosos que dejen los fallos del
CI que pasan al relanzar el job».

## Especificación

**Candidatos** (de «Mejoras anotadas» del BACKLOG; títulos tal como están en los specs):

1. `tenants.spec.ts`, «AUD-03: un secreto escrito sin guardar pide confirmación al cerrar» (falló con
   `--repeat-each 3`, anotado en la 0064). Ficha de arreglo: **0077**.
2. `tenants.spec.ts`, «AUD-21: Ctrl+K con un diálogo abierto saca la paleta por encima y con el foco»
   (ídem). Ficha de arreglo: **0078**.
3. «v0.10.0: tabla de evidencias: estado propio por evento en un problema cerrado, columnas y
   celdas» (falló una vez en una tirada completa, anotado en la 0006).
4. «CA2 (0005): con la ventana más pequeña que permite la app, el enlace «Problemas» de la barra
   superior se ve y recibe un clic normal» (timeout con los workers en paralelo, anotado en la 0039).
5. Los sospechosos que el Orquestador haya anotado en el BACKLOG por un fallo del CI que pasó al
   relanzar (ADR-0013), hasta el día en que empiece esta ficha.

Los 3 y 4 están anotados como intermitentes en el BACKLOG, aunque el ADR solo nombra los dos de
`tenants.spec.ts`. Propuesta del Planificador, aprobada por Dani con el lote (2026-10-10): se
miden también, y solo van a cuarentena si fallan.

**Medición** (con la app compilada una vez):

- Cada candidato con `--repeat-each 5`, con los workers de siempre y, si pasa, también con
  `--workers=1` en su spec entero (los fallos con varios workers y los de orden salen distintos). Los
  de `views-portapapeles.spec.ts`, siempre con `--workers=1`.
- Para cada uno se apunta en «Verificación»: comando, hora de inicio y fin (`date`), pasan y fallan,
  y el mensaje del primer fallo **resumido** (sin capturas ni logs en la ficha).

**Cuarentena:** un candidato que falla al menos una vez se etiqueta `@inestable` con la anotación
`arreglo` de su ficha (0077, 0078). Si falla uno de los 3, 4 o 5, el Orquestador pide al Planificador
su ficha de arreglo (`SendMessage`) antes de etiquetarlo; la guarda de la 0075 no deja etiquetarlo
sin ella. Un candidato que no falla en ninguna tanda no se toca: se anota el resultado en el BACKLOG
(«no reproducido el AAAA-MM-DD, N de N») y, si es el 1 o el 2, el Orquestador avisa al Planificador
para dejar su ficha de arreglo en espera.

Si un test de `tenants.spec.ts` (modo serie) no se puede sacar sin romper los siguientes (0075), se
para y se pregunta (`[ALCANCE]`).

El doc-writer rellena la sección «Tests en cuarentena» del BACKLOG.

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: se cumple; solo etiquetas y anotaciones.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **no se cumple**, cambia qué tests bloquean el CI.
4. No hay ninguna decisión que preguntar a Dani: **no se cumplía**: incluir los candidatos 3 y 4 lo aprobó Dani
   con el lote.

## Criterios de aceptación

- CA1: cada test que falló en la medición tiene `@inestable` y la anotación `arreglo` con una ficha
  que existe (la guarda de la 0075 pasa).
- CA2: `npm run test:e2e:inestables -- --list` lista exactamente los tests en cuarentena, y
  `npm run test:e2e:nobuild -- --list` (proyecto `e2e`) no lista ninguno de ellos.

Que ningún test que pasó todas las tandas lleve `@inestable` no es un criterio (no hay test
automático que lo vea): lo comprueban el reviewer y el verifier contra la tabla de la medición.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Arreglar los tests (0077, 0078 y las que salgan).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
