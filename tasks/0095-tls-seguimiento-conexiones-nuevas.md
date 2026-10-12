---
id: '0095'
titulo: 'TLS, seguimiento de la 0079: dos conexiones nuevas a un host cuando la sesión ya no recuerda la decisión del verificador'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: seguridad-revision # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0095-tls-seguimiento-conexiones-nuevas
adrs: [3] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

BACKLOG, «Propuestas» (surgió en la 0079): «Ficha de seguimiento de seguridad del resto de la
verificación de certificados (dos conexiones nuevas a un host cuando la sesión ya no recuerda la
decisión); pendiente del Planificador». Dani la metió en el lote `seguridad-revision` el 2026-10-11,
al aprobarlo.

## Especificación

**Lo que queda de la 0079** (su «Resultado», «Lo que queda»). La 0079 hace que la primera petición a
cada host de cada sesión vaya sola (`gatedFetch`, `src/main/dynatrace/network.ts`), porque dos
conexiones nuevas a la vez al mismo host pueden saltarse el verificador de la app. La sesión recuerda
la decisión del verificador para cada host y, pasado un tiempo, la olvida; si entonces abre a la vez
dos conexiones nuevas a ese host, la ventana vuelve a abrirse. Desde la app no se ve ni cuándo la
olvida ni cuándo se abre una conexión nueva. La ventana dura lo que tarda el verificador en
responder (milisegundos).

**Repositorio público** (decisión de Dani en la 0079): en la ficha, los tests, los comentarios y los
mensajes de commit queda solo lo nuestro, sin la cadena interna de Electron ni el paso a paso. Lo que
haga falta de eso va fuera del repositorio. El Orquestador comprueba antes del push que lo que se
sube no lo lleva, como en la 0079, y el reviewer lo revisa en el diff con la lista que se guarda
fuera del repositorio (no puede ser un test: la lista no puede estar en él).

1. **Primero, opciones; después, código.** El developer estudia las salidas y las presenta con un
   `[ALCANCE]` (lo decide Dani) antes de implementar ninguna, con su coste para el usuario. Las que
   anotó la 0079, y cualquier otra que encuentre:
   - renovar la sesión del entorno antes de que olvide la decisión (cambia cuándo se crea una
     partición, ADR-0003; cada sesión nueva se queda en memoria hasta cerrar la app; puede no cubrir
     todos los casos);
   - poner en fila todas las peticiones a un host (frena todas las vistas);
   - lo que Electron ofrezca o responda al aviso privado que envió Dani (si ha respondido, Dani lo
     dice al empezar la ficha);
   - dejarlo como riesgo aceptado y documentado, si ninguna compensa.
2. **Límites, los de la 0079:** no se acepta un certificado que `verifyCertificate`
   (`src/main/dynatrace/tls.ts`) no acepta ni se cambia su tabla; «ignorar» no vale para el SSO ni
   para hosts ajenos al entorno; no se reintenta un rechazo real hasta que entre; no se pone en logs
   nada más de lo que ya se pone.
3. Si Dani elige «riesgo aceptado», la ficha se cierra documentándolo en `docs/ARCHITECTURE.md` (o en
   el ADR-0003) sin código, y los criterios CA1 y CA2 no aplican (se dice en «Resultado»).

**Decisión de Dani (2026-10-12): opción «3a + 7»** del estudio del punto 1 (se guardó fuera del
repositorio):

4. **Fila solo para los hosts con huella fijada.** Para un host que tiene huella fijada en el
   entorno (nivel «fijada», o el SSO con huella), `gatedFetch` (`src/main/dynatrace/network.ts`)
   manda las peticiones de una en una, siempre, no solo la primera. Para el resto (todo «sistema»,
   hosts sin huella y los hosts del entorno con «ignorar») sigue como hoy: la primera sola y después
   a la vez. Si un host va en fila sale de una función pura con los mismos datos que ya usa la
   decisión del verificador (nivel, huellas y hosts del entorno); no se toca `verifyCertificate` ni
   su tabla. Esos datos ya renuevan la sesión al cambiar, así que la decisión no se queda desfasada.
   Las peticiones que esperan en la fila siguen respetando su plazo y su cancelación (`init.signal`).
5. **Riesgo aceptado para lo que no cierra la fila:** con «ignorar», un «Certificado no de
   confianza» de vez en cuando (se arregla con «Actualizar»), sin impacto de seguridad. Se documenta
   en el ADR-0003 (o en `docs/ARCHITECTURE.md`), junto con que se revisa todo si Electron responde
   al aviso privado. Sin la cadena interna de Electron (ver «Repositorio público»).
6. **Ayuda en la interfaz:** donde se elige el nivel de certificados del entorno, al elegir «Huella
   fijada» sale un texto corto que avisa de que, con huella fijada, las vistas piden los datos de uno
   en uno y pueden tardar más. En español y en inglés.

## Carril

Normal (`ligera: no`), con la exclusión `seguridad` (verificación de certificados): va sola en su PR
y la fusiona Dani.

1. No añade componentes, funciones ni cálculos nuevos: no se sabe hasta elegir la salida (en la duda,
   no se cumple).
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: no se cumple; toca la red del proceso principal.
4. No hay ninguna decisión que preguntar a Dani: no se cumple (la salida del punto 1).

## Criterios de aceptación

- CA1: con la sesión simulada de la 0079 (`network.verifier-cache.test.ts` o uno parecido), con el
  nivel «fijada» y el host con huella fijada, cuando la sesión ha olvidado la decisión y se lanzan
  dos peticiones a la vez a ese host, ninguna se lleva el resultado de Chromium sin pasar por el
  verificador de la app; sin el arreglo, el test falla. Test con «CA1 (0095)».
- CA2: los tests de la 0079 (CA1 a CA4) y los de certificados (`tls.test.ts`, `network.test.ts`,
  `client.https.test.ts`, `e2e/tls.spec.ts`) siguen en verde sin cambiar lo que esperan.
- CA3: con el nivel «sistema» (y con un host sin huella fijada), después de que la primera petición
  a un host acabe bien, las siguientes van a la vez, como hoy: no se ponen en fila. Test con «CA3
  (0095)».
- CA4: con un host con huella fijada, una petición que espera en la fila y se cancela (o agota su
  plazo) sale de la fila con su error sin esperar a las de delante, y no bloquea a las de detrás.
  Test con «CA4 (0095)».
- CA5: en el formulario del entorno, con «Huella fijada» elegido sale el aviso de que las vistas
  piden los datos de uno en uno y pueden tardar más; con «Certificados del sistema» o «Ignorar
  errores» no sale. Textos en `es` y `en`. Test con «CA5 (0095)».
- CA6: el ADR-0003 (o `docs/ARCHITECTURE.md`) recoge como riesgo aceptado el falso «Certificado no de
  confianza» con «ignorar» y que se revisa si Electron responde, sin la cadena interna de Electron.
  Lo comprueba el reviewer.

## Pruebas a mano para Dani

- Ninguna: con el tenant de pruebas el certificado es de una CA pública y no se usa «ignorar».

## Fuera de alcance

- Cambiar la tabla de decisiones de `tls.ts` o los niveles de certificado.
- Poner en fila los hosts del entorno con «ignorar» (opción 3b) y reintentar el falso «no de
  confianza» de «ignorar» (opción 5): Dani eligió dejarlo como riesgo aceptado (2026-10-12).
- La cola de gráficos de la 0086, aunque también pase por `gatedFetch`.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- Criterios: CA1 (`network.verifier-cache.test.ts`, certificado propio con huella y CA pública con otra huella), CA3 y CA4 (`network.test.ts`), CA5 (`e2e/tls.spec.ts`, es y en, `certificates.pinnedSlower` con `aria-describedby`), CA2 (los tests solo añaden; no cambia lo que esperaban los de la 0079 ni los de certificados) y CA6 (sección «Seguimiento» del ADR-0003).
- Fila de `gatedFetch` (`network.ts:83-112`): entre salir del `while` y ocupar `gate.pending` no hay `await`, así que no pasan dos a la vez; la que se cancela o agota el plazo sale sin tocar la fila; si falla la que está en la red, el `finally` suelta la fila con `verified` en `false`. `queued(host)` no puede cambiar a media sesión (`onEnvironmentChanged` → `reset`).
- `verifyCertificate` y su tabla sin cambios; `queuesRequests` (`tls.ts:36-48`) sigue sus ramas y un test falla si se separan. Poner en fila si falla leer los datos del verificador es el lado seguro.
- Sin logs nuevos, IPC, API, esquema ni dependencias.
- Repositorio público: el diff y los commits no llevan nada de la lista guardada fuera del repositorio.

Opcional, no bloquea:

- La fila va por host con puerto (`URL.host`) y el verificador decide por nombre de host: dos puertos del mismo host con huella no comparten fila. Ya pasaba en la 0079; idea para «Ideas surgidas» (sería `[ALCANCE]`).
- Una espera cancelada deja un `.then` enganchado a la promesa de la fila; inofensivo, se resuelve siempre en el `finally`.
- El doc-writer puede ampliar la lección de la 0079 en `src/main/CLAUDE.md`: desde la 0095, los hosts con huella fijada van siempre de uno en uno.

## Verificación

Tests escritos en el commit `1a4216f` (fallan sin el arreglo, por lo que piden):

- CA1: `src/main/dynatrace/network.verifier-cache.test.ts`, describe «CA1 (0095)»: tras una primera
  petición que entra, la sesión simulada olvida la decisión y la segunda llega mientras la primera
  espera al verificador. Con «fijada» y la huella de un certificado propio, las dos entran (sin el
  arreglo, la segunda sale `TLS_UNTRUSTED`); con otra huella y CA pública, las dos
  `TLS_PIN_MISMATCH` (sin el arreglo, la segunda entra).
- CA2: tests existentes, sin cambios.
- CA3: `src/main/dynatrace/network.test.ts`, describe «CA3 (0095)»: con «sistema» (sin huellas y con
  una huella guardada del host), «fijada» sin huella para el host (o solo de otro) e «ignorar», tras
  la primera que entra las dos siguientes llegan juntas a la red. Pasan ya (guarda de lo de hoy).
- CA4: `src/main/dynatrace/network.test.ts`, describe «CA4 (0095)»: con huella fijada, de una en una
  también después de la primera; una que espera y se cancela (`AbortError`) o agota su plazo
  (`TimeoutError`) sale con el motivo de su señal mientras la de delante sigue en la red, nunca llega
  a la red, y la de detrás pasa al acabar la de delante.
- CA5: `e2e/tls.spec.ts`, «CA5 (0095)» (antes del último test del spec, en serie): el aviso es
  `data-testid="certificate-pinned-notice"` dentro de `environment-form`; con «pinned» se ve y dice
  «de uno en uno» y «tardar más» (es) y «one at a time» u «one by one» (en); con «system» e «ignore»
  no existe.
- CA6: lo comprueba el reviewer (sección «Seguimiento» del ADR-0003).

Tests añadidos por el developer (el test-writer no probó el SSO con huella), en commit `f5fc565`:

- `src/main/dynatrace/tls.test.ts`, «queuesRequests (0095)»: «fijada» con huella en fila; el SSO
  con huella en fila con «fijada» y con «ignorar»; «sistema», sin huella e «ignorar» en un host del
  entorno, no; y una guarda de que va en fila justo cuando la decisión de `verifyCertificate`
  depende de la huella (si cambia la tabla sin cambiar la fila, falla).
- `src/main/dynatrace/network.test.ts`, «0095 (developer)»: el SSO con huella va de una en una con
  «ignorar» y con «fijada»; sin huella, a la vez; y si leer los datos del verificador lanza (entorno
  borrado con una petición en curso), en fila (decisión del developer: lo más seguro, como el
  verificador, que en ese caso rechaza).

Verificación 2026-10-12, commit 4aa3900, rango `origin/main..fix/0095-tls-seguimiento-conexiones-nuevas`: **VERDE**

- `check`: 226 ficheros y 4216 tests en verde; cobertura de sentencias 92,98 %, ramas 90,13 %, funciones 90,37 % y líneas 93,75 %.
- e2e (`test:e2e:affected`, un pase): 330 pasan, 0 fallos, 1,5 min. Sin repetir ×3: el diff no toca temporización de la interfaz.
- Worktree desechable con `npm ci --ignore-scripts` y `npx install-electron`; `core.bare` del checkout principal sigue en `false`.

## Resultado

Commits: `1a4216f` (tests), `f5fc565` (fila), `e82eca1` (aviso en el formulario), `7eb2c50` (ADR-0003). Una ronda de revisión (aprobada a la primera). Sin ADR nuevo (sección «Seguimiento» en el ADR-0003). Sin migraciones.

Ficheros principales: `src/main/dynatrace/network.ts` (fila en `gatedFetch`), `src/main/dynatrace/tls.ts` (`queuesRequests`), `src/renderer/src/settings/EnvironmentForm.tsx` y los textos `es`/`en` (aviso), `docs/adr/0003-particion-por-generacion.md`.

Decisión de Dani: opción «3a + 7» (fila solo para huella fijada; riesgo aceptado para «ignorar»). Pendiente de Dani: enviar el aviso privado a Electron (anotado en el BACKLOG).

Ideas surgidas del reviewer, llevadas al BACKLOG: fila por host con puerto frente a verificador por nombre (`[ALCANCE]`) y el `.then` que deja una espera cancelada. La tercera (lección en `src/main/CLAUDE.md`) aplicada.
