---
id: '0076'
titulo: 'e2e: medir los sospechosos de inestables y poner en cuarentena los que fallan'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0075'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0076-e2e-poner-en-cuarentena
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
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

- Decisión de Dani (2026-10-11, `[ALCANCE]` del developer): AUD-03 no se pone en cuarentena. Depende del cliente y el entorno que crean los tests anteriores de `tenants.spec.ts` (modo serie) y en el proyecto `inestables`, solo, fallaría siempre. Se arregla directamente en la 0077 (se reproduce con `--workers=1`, 3 de 5). Esta ficha se cierra solo con la medición, sin ningún test etiquetado.
- Decisión de Dani (2026-10-11): AUD-21 y los candidatos de views no se reprodujeron; la 0078 queda `en_espera` hasta que el CI o una medición vuelva a verlo fallar.

- Arreglar los tests (0077, 0078 y las que salgan).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- Medición completa y coherente con la especificación: una compilación; AUD-03 y AUD-21 con `--repeat-each 5` con 4 workers y con `--workers=1`; AUD-03 también solo (depende del modo serie); AUD-21 sin AUD-03; candidatos 3, 4 y 5 aislados con `--workers=1` y `views` entero. Cada tanda con comando, horas, resultado y primer fallo; las cuentas cuadran (AUD-21: 5 + 2 + 5 = 12). Sin capturas, logs ni datos del tenant.
- Decisiones de Dani respetadas: ningún `@inestable` (el diff no toca `e2e/`), «Tests en cuarentena» del BACKLOG en «(ninguno todavía)», 0078 `en_espera` con su motivo.
- Tests: CA1 (`checkTags` sobre los specs reales y las fichas) y CA2 (`--list` de `inestables` y `e2e` frente a un proyecto sin filtro) quedan como guarda; sin tocar desde 9f41b4c.
- Opcional: cerrar en «Verificación» el párrafo del `[ALCANCE]` con la decisión de Dani; en la línea de AUD-03 del BACKLOG, «no va a cuarentena; se arregla en la 0077».
- Aviso para la 0077: su punto 3 de «Especificación» (quitar `@inestable` y la anotación `arreglo`) y su CA2 («ya no tiene `@inestable`») sobran con la decisión de Dani; hay que ajustarlos antes de empezarla. Causa apuntada por la medición: con `--workers=1` (3 de 5) `confirm-dialog` no aparece tras Escape; depende del modo serie.

## Verificación

Tests (commit `9f41b4c`, `scripts/e2e-cuarentena.test.ts`):

- CA1 → «CA1 (0076): la guarda de la 0075 no da problemas de cuarentena en los specs reales» (`checkTags` sobre `e2e/*.spec.ts` y `tasks/`, solo los problemas de cuarentena).
- CA2 → «CA2 (0076): el proyecto inestables lista exactamente los tests con @inestable» y «CA2 (0076): el proyecto e2e no lista ninguno con @inestable y sí todos los demás» (`--list --reporter=json` de la config real frente a un proyecto sin filtro).

Los tests no fijan qué tests van a cuarentena (sale de la medición): pasan ya antes del desarrollo, con ningún test etiquetado. Comprobado a mano que CA1 falla si se etiqueta AUD-03 con `@inestable` sin `arreglo` y pasa con `arreglo: 0077`.

Medición (developer, 2026-10-11; app compilada una vez con `npm run build`, 02:47:11-02:47:47; todo con `npx playwright test --project=e2e`):

| #       | Candidato                      | Comando                                                                                                       | Inicio   | Fin      | Pasan                                                    | Fallan   | Primer fallo                                                                                                              |
| ------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------- | -------- | -------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1, 2    | AUD-03 y AUD-21                | `e2e/tenants.spec.ts --repeat-each 5` (4 workers)                                                             | 02:47:59 | 02:48:20 | AUD-03 5, AUD-21 5 (130 de 130)                          | 0        | —                                                                                                                         |
| 1, 2    | AUD-03 y AUD-21                | `e2e/tenants.spec.ts --repeat-each 5 --workers=1`                                                             | 02:48:24 | 02:49:18 | AUD-03 2, AUD-21 2 (88; 39 sin correr por el modo serie) | AUD-03 3 | Vuelta `Escape`: tras pulsar Escape con un secreto escrito, `confirm-dialog` no aparece en 5 s (`toBeVisible`, línea 534) |
| 1       | AUD-03 solo                    | `e2e/tenants.spec.ts -g "AUD-03: un secreto escrito sin guardar"`                                             | 02:49:29 | 02:50:02 | 0                                                        | 1        | `locator.click` 30 s: no existe la fila «Cliente A › Producción» (la crean los tests anteriores)                          |
| 2       | AUD-21                         | `e2e/tenants.spec.ts --repeat-each 5 --workers=1 --grep-invert "AUD-03: un secreto escrito sin guardar"`      | 02:50:07 | 02:50:56 | 5 (125 de 125)                                           | 0        | —                                                                                                                         |
| 3       | v0.10.0 tabla de evidencias    | `e2e/views.spec.ts -g "tabla de evidencias: estado propio por evento" --repeat-each 5 --workers=1`            | 02:51:03 | 02:51:30 | 5                                                        | 0        | —                                                                                                                         |
| 4       | CA2 (0005) ventana mínima      | `e2e/views.spec.ts -g "con la ventana más pequeña que permite la app, el enlace" --repeat-each 5 --workers=1` | 02:51:30 | 02:51:45 | 5                                                        | 0        | —                                                                                                                         |
| 5       | CA1 (0036) tarjeta Información | `e2e/views.spec.ts -g "CA1 \(0036\)" --repeat-each 5 --workers=1`                                             | 02:51:45 | 02:52:21 | 5                                                        | 0        | —                                                                                                                         |
| 3, 4, 5 | `views` entero                 | `e2e/views.spec.ts --workers=1`                                                                               | 02:52:27 | 02:57:49 | 265 de 265                                               | 0        | —                                                                                                                         |

El 5 es el único sospechoso del CI anotado en el BACKLOG hasta hoy. `views` va siempre con `--workers=1` (portapapeles), así que los fallos de 4 y 5 «con los workers en paralelo» (otros specs a la vez) no se han podido repetir en estas tandas.

Resultado: AUD-03 falla 3 de 5 con `--workers=1`. **No se ha etiquetado:** depende del cliente y del entorno que crean los tests anteriores del spec en serie y, lanzado solo, falla (comprobado arriba), así que en el proyecto `inestables` fallaría siempre (`e2e/CLAUDE.md`, cuarentena en modo serie). No deja nada a los siguientes (aceptar descarta el secreto). Se para y se pregunta (`[ALCANCE]`). AUD-21, 3, 4 y 5 no fallan en ninguna tanda: no se tocan (anotado en el BACKLOG).

**Decisión de Dani (2026-10-11) sobre el `[ALCANCE]`:** AUD-03 no se pone en cuarentena y se arregla directamente en la 0077; la 0078 queda en espera porque AUD-21 no se reprodujo.

Verificación 2026-10-11, commit 647bd9f, rango `integra/20261011-3..feat/0076-e2e-poner-en-cuarentena`: **VERDE**.

- `npm run check`: 211 ficheros, 3692 tests; cobertura: sentencias 92,68 %, ramas 89,98 %, funciones 89,84 %, líneas 93,43 %. `scripts/e2e-cuarentena.test.ts` (dentro del `include` de vitest), aparte: 4 de 4 (comprobado por el Orquestador).
- `npm run test:e2e:affected`: «solo docs o tests unitarios; no hace falta ningún e2e» (cero e2e).

## Resultado

- Commits: `9f41b4c` (tests de la guarda), `d14fdde` y `4a3da47` (medición y decisiones de Dani), `647bd9f` (revisión) y el de cierre. Sin cambios en `src/` ni en `e2e/`.
- Ficheros principales: `scripts/e2e-cuarentena.test.ts` (CA1 y CA2), `BACKLOG.md` (mediciones anotadas; «Tests en cuarentena» queda en «ninguno todavía») y la ficha 0078 (en espera).
- Resultado de la medición: ningún test en cuarentena. AUD-03 falla 3 de 5 con `--workers=1`, pero se arregla en la 0077; AUD-21 y los candidatos 3, 4 y 5 no fallaron en ninguna tanda.
- Rondas de revisión: 1 (APROBADO). ADR nuevo: ninguno.
