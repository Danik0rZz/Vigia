---
id: '0077'
titulo: 'e2e inestable: AUD-03, confirmación al cerrar con un secreto sin guardar (tenants.spec.ts)'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: e2e-inestables # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0076'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0077-e2e-aud-03-secreto-sin-guardar
adrs: [13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
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

- Decisión de Dani (2026-10-11, en la 0076): AUD-03 no llegó a ponerse en cuarentena, porque depende del modo serie de `tenants.spec.ts` y solo fallaría siempre. Por eso el punto 3 de «Especificación» no aplica y CA2 se lee como «el test sigue sin `@inestable` y la guarda de la 0075 sigue en verde». Medición de la 0076: pasa 5 de 5 con 4 workers y falla 3 de 5 con el spec entero y `--workers=1` (tras Escape con un secreto escrito, `confirm-dialog` no aparece en 5 s).
- `exclusiones: []` lo decidió Dani; si el arreglo toca el manejo de secretos (seguridad), el reviewer lo marca y la ficha pasa a ir sola en su PR.

- Los otros tests de `tenants.spec.ts` (AUD-21 es la 0078).

## Ideas surgidas (fuera de alcance)

- (developer) Lección para `src/renderer/CLAUDE.md`: lo que decide al cerrar un diálogo de Radix
  (Escape, clic fuera) no puede depender de un `setState` hecho en un `useEffect` del hijo; Chromium
  atiende la tecla antes que esa tarea de React. Puede haber otros formularios con el mismo patrón.
- (developer) El primer comando de CA1 en «Verificación» (`-g "AUD-03: …"`) no puede pasar nunca:
  lanzado solo, el test no tiene el cliente ni el entorno que crean los anteriores (lo mismo que
  midió la 0076). Se ha medido con el spec entero y los workers de siempre.
- (developer) Para la 0078: AUD-21 falló una vez en `npm run test:e2e:affected -- integra/20261011-3..HEAD`
  (2026-10-11, 10:01:18-10:01:29): `onTop` es `false` en la línea 850 (en el centro de la paleta
  no está la paleta). No viene de esta ficha: abre el alta de un entorno, sin `SecretsPanel`, así
  que el cambio no interviene; en las dos tandas de CA1 pasó 20 de 20 con el mismo `out/`.

## Notas del revisor

### Ronda 1: APROBADO

- Criterios: CA3 lo cubre «CA3 (0077): Escape en la misma tarea en que se escribe el secreto también pide confirmación» (`e2e/tenants.spec.ts`): escribe y lanza Escape en el mismo `evaluate`, justo la carrera descrita. Antes, `SecretRow` llamaba a `setDirtySecrets` desde un `useEffect` y `requestClose` veía el conjunto vacío; ahora el `Set` se modifica en el sitio y se lee al cerrar. Tests sin tocar desde fc59ad7. CA1 medido 10 de 10 con 4 workers y con 1 worker; CA2 sin cambios (`@tenants`). El rojo sin el arreglo lo confirma el verifier.
- Patrón (`EnvironmentForm.tsx:64-83`): `dirtySecrets` solo se lee en `requestClose`; nada del JSX depende de él; identidad estable; el efecto de `SecretRow` sigue limpiando al desmontarse; el caso de la 0064 igual; con el React Compiler se lee el `Set` vivo.
- Seguridad: el conjunto solo guarda el `SecretKind`, nunca el valor, que sigue solo en `SecretRow`. Token del test falso y comprobado fuera del DOM. Sin IPC, API, esquema ni dependencias.
- `[EXCLUSIONES] no`: no cambia qué cuenta como «sin guardar» (`value.trim() !== ''` en `SecretRow`), ni el guardado, el cifrado ni la exposición del valor; solo cuándo se entera `EnvironmentForm`. No hace falta que vaya sola.
- Opcional: `useRef(new Set())` sería lo habitual (una regla futura de inmutabilidad podría quejarse del `useState` mutado); la lección de «Ideas surgidas» encaja en `src/renderer/CLAUDE.md`; corregir el comando de CA1 con `-g` de «Verificación» (AUD-03 depende del modo serie).

## Verificación

Test-writer (2026-10-11): no se escriben tests antes de conocer la causa; ningún criterio se puede
escribir hoy como un test que falle por falta de código.

- CA1 es una medición, no un test nuevo. La hace el verifier (y el developer antes de entregar):
  `npm run test:e2e:nobuild -- e2e/tenants.spec.ts --repeat-each 10`
  con los workers de siempre (10/10; con `-g` no puede pasar: AUD-03 depende del modo serie), y `npm run test:e2e:nobuild -- e2e/tenants.spec.ts --workers=1 --repeat-each 10`
  (el spec entero, 10/10; es el caso que falló 3 de 5 en la 0076).
- CA2 ya se cumple hoy y debe seguir así: el test lleva solo `{ tag: '@tenants' }` (sin
  `@inestable` ni anotación `arreglo`) y `npx vitest run scripts/e2e-tags.test.ts` pasa (20/20 el
  2026-10-11). Lo comprueba el verifier.
- CA3 depende de dónde esté la causa. Si está en la app, el developer escribe el test que la
  demuestra (unitario junto al componente o e2e en `tenants.spec.ts`, con «(0077)» en el nombre) y
  el verifier comprueba que falla sin el arreglo (revirtiendo solo el cambio de producción) y pasa
  con él. Si la causa está en el test (espera o dependencia del modo serie), CA3 no aplica y la
  ficha lo dice en «Resultado».

Verificación 2026-10-11, commit 0c1d2e5, rango `integra/20261011-3..fix/0077-e2e-aud-03-secreto-sin-guardar`: **VERDE**.

- `npm run check`: 3692 tests; cobertura: sentencias 92,68 %, ramas 89,98 %, funciones 89,84 %, líneas 93,43 %.
- e2e afectados, un pase: 58 pasados (`@tenants`, `@tls`, `@smoke`).
- CA1: `e2e/tenants.spec.ts` entero con `--repeat-each 10`: 270 pasados, 0 fallos (hasta las 10:07:04); con `--workers=1 --repeat-each 10`: 270 pasados, 0 fallos (hasta las 10:08:53). AUD-03 10 de 10 en las dos.
- CA3: con el arreglo, «CA3 (0077)…» pasa (afectados y 20 repeticiones). Sin el arreglo (solo `EnvironmentForm.tsx` revertido a la base, compilado): el spec cae en rojo en AUD-03 (`tenants.spec.ts:514`, el diálogo de confirmación no aparece; 12 pasados y 1 fallo), y por el modo serie «CA3 (0077)» no llega a ejecutarse. Salvedad: el verifier no lo vio fallar por sí solo; el developer lo vio en rojo con el commit solo de test (fc59ad7). Quitar el arreglo no deja pasar nada.
- AUD-21 pasó en todas las tandas del verifier.

## Resultado

**Causa: carrera en la app**, no en el test. `EnvironmentForm` llevaba los secretos sin guardar en
un estado (`useState` con un `Set` nuevo en cada cambio) que `SecretRow` actualizaba desde un
`useEffect`. Ese `setState`, hecho dentro de un efecto, va con prioridad normal y React lo pinta en
una tarea aparte. Chromium da prioridad a las tareas de entrada: la pulsación de Escape podía
atenderse antes, y `onOpenChange` de Radix llamaba a la `requestClose` del pintado anterior, que
veía el conjunto vacío y cerraba sin preguntar. El clic en «Cancelar» no fallaba porque Playwright
espera a que el botón esté estable (varios fotogramas) antes de pulsar. Con el spec entero y un
worker cambia el reparto de tareas y la carrera sale más.

**Arreglo** (`src/renderer/src/settings/EnvironmentForm.tsx`): el conjunto se crea una vez y se
modifica en el sitio desde `onSecretDirty`; `requestClose` lo lee al momento. No cambia qué cuenta
como «sin guardar» (`SecretRow`, valor no vacío), ni el guardado, ni el cifrado, ni lo que ve el
usuario; el valor del secreto sigue sin salir de `SecretRow`.

- CA3: «CA3 (0077): Escape en la misma tarea en que se escribe el secreto también pide
  confirmación» (`e2e/tenants.spec.ts`) escribe y pulsa Escape en la misma tarea; commit solo de
  test fc59ad7, en rojo sin el arreglo (el formulario se cierra sin `confirm-dialog`), verde con él.
- CA1 (2026-10-11, sobre el arreglo final a1c31b7):

| Tanda                     | Comando                                            | Inicio   | Fin      | Resultado                                        |
| ------------------------- | -------------------------------------------------- | -------- | -------- | ------------------------------------------------ |
| Antes del arreglo         | `e2e/tenants.spec.ts --workers=1 --repeat-each 5`  | 09:46:35 | 09:47:32 | AUD-03 falla 2 de 5 (vuelta `Escape`, línea 534) |
| Con el arreglo, 4 workers | `e2e/tenants.spec.ts --repeat-each 10`             | 09:57:34 | 09:58:06 | 270 de 270; AUD-03 10 de 10                      |
| Con el arreglo, 1 worker  | `e2e/tenants.spec.ts --workers=1 --repeat-each 10` | 09:58:06 | 09:59:54 | 270 de 270; AUD-03 10 de 10                      |

- CA2: el test sigue solo con `{ tag: '@tenants' }`; la guarda va en `npm run check`.
- Commits: fc59ad7 (test CA3), a1c31b7 (arreglo). Ficheros principales: `src/renderer/src/settings/EnvironmentForm.tsx`, `e2e/tenants.spec.ts`. Rondas de revisión: 1 (APROBADO). ADR nuevo: ninguno. Sin migraciones.
- AUD-21 falló una vez en el e2e afectado del developer (ver la 0078).
