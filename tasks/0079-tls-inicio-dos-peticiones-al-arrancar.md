---
id: '0079'
titulo: 'Bug: al abrir Inicio recién arrancada, con el nivel «ignorar», una de las dos peticiones puede salir como «Certificado no de confianza»'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0079-tls-inicio-dos-peticiones
adrs: [2, 3, 5, 6] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 3
---

## Petición original

Surgió en la 0070 (developer, «Ideas surgidas» de su rama `feat/0070-e2e-vistas-por-zona-y-workers`,
commit `8b129ff`). Dani eligió la opción 1 (2026-10-11): una ficha de bug aparte antes de la 0070;
después, la 0070 repite sus tres pases con 8 workers.

El fallo: al abrir Inicio recién arrancada la app, con dos peticiones a la vez al mismo entorno
(problemas y SLOs) y el nivel de certificado en «ignorar», una puede salir como «Certificado no de
confianza» (`TLS_UNTRUSTED`) aunque la otra entre. Con «Actualizar» un momento después, entra. Sale
también con 4 workers y con el puerto 0. Es un fallo de la app, no del arnés: no se tapa en el test.

## Especificación

Zona probable: `src/main/dynatrace/network.ts` (sesión por entorno y verificador de
`setCertificateVerifyProc`, ADR-0003) o `src/main/dynatrace/client.ts` (la clasificación del error de
red como `TLS_UNTRUSTED` cuando el texto lleva `ERR_CERT`/`ERR_SSL` o el verificador anotó un
fallo). Son pistas, no el diagnóstico.

0. **Base:** la rama sale de `main`, no de la de la 0070 (que no está en `origin`). La reproducción
   vive en un test propio de esta ficha (CA1), que no depende del reparto de la 0070. En `main` el
   fallo no se ve hoy porque, en `views.spec.ts` sin partir, ese test no es el primero de su app.
1. **Causa antes que arreglo.** Reproducirlo y explicar en la ficha (en «Resultado») por qué la
   segunda petición sale como certificado no de confianza: qué error devuelve Chromium a esa
   petición, si el verificador llegó a llamarse para ella y con qué resultado, y por qué
   «Actualizar» entra. Reproducción de referencia: en la rama de la 0070, el primer test de
   `views-inicio.spec.ts` con varios workers (`kpi-open-problems` se queda en «—»); en `main`, el
   test de CA1 de esta ficha. Nada de subir tiempos de espera ni de reintentar sin causa.
2. **Arreglo donde está la causa**, con un test unitario que lo demuestre (CA2).
3. **Límites de seguridad** (por eso lleva la exclusión `seguridad`). El arreglo no puede:
   - aceptar un certificado que `verifyCertificate` (`src/main/dynatrace/tls.ts`) no acepta, ni
     cambiar su tabla de decisiones;
   - hacer que «ignorar» valga para el SSO o para hosts que no son del entorno;
   - reintentar un rechazo real del verificador (huella distinta o certificado no aceptado con
     «sistema» o «fijada») hasta que entre, ni dejar de mostrar `TLS_UNTRUSTED` o
     `TLS_PIN_MISMATCH` cuando el rechazo es real;
   - poner en logs o mensajes de error nada más de lo que ya se pone (host con puerto; nunca
     cabeceras ni secretos).

   Si la única salida que se ve se sale de estos límites, o es reintentar una petición fallida de
   forma general, se para y se pregunta (`[ALCANCE]`, lo decide Dani).

4. Si la causa resulta ser de Electron o de Chromium sin arreglo posible en la app, se para y se
   pregunta (`[ALCANCE]`) con lo encontrado y las fuentes; la ficha no se da por hecha con un
   apaño en el test.

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: no se sabe hasta conocer la causa (en la
   duda, no).
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **no se cumple**; toca la lógica de red y de verificación de
   certificados del proceso principal.
4. No hay ninguna decisión que preguntar a Dani: se cumple, salvo los `[ALCANCE]` de los puntos 3
   y 4.

Además toca la seguridad (verificación de TLS): exclusión `seguridad`, va sola en su PR y la
fusiona Dani.

## Criterios de aceptación

- CA1: un e2e nuevo con «(0079)» en el título y la etiqueta de su zona (ficha 0067): con un entorno
  en nivel «ignorar» contra el Dynatrace simulado, la app recién arrancada abre Inicio como primera
  vista y los dos paneles (problemas abiertos y SLOs) cargan sin «Certificado no de confianza». Pasa
  20 de 20 con `--repeat-each 20` y 4 workers (cada repetición arranca su propia app). Antes del
  arreglo tiene que fallar alguna vez con ese mismo comando; si no falla en `main`, se dice en la
  ficha y se usa la reproducción de la rama de la 0070 para comprobar el antes y el después.
- CA2: un test unitario con «(0079)» en el nombre que reproduce la causa encontrada de forma
  determinista (sin depender de tiempos): falla sin el arreglo y pasa con él.
- CA3: los tests de seguridad de certificados siguen en verde sin cambiar lo que esperan (se pueden
  añadir casos, no quitar ni relajar): `src/main/dynatrace/tls.test.ts`, `network.test.ts`,
  `client.https.test.ts` y `e2e/tls.spec.ts`. En concreto, con «sistema» y un certificado propio
  sigue saliendo `TLS_UNTRUSTED`; con «fijada» y otra huella, `TLS_PIN_MISMATCH`; y con «ignorar»,
  el SSO no se acepta sin validar.
- CA4: un test unitario con «(0079)» en el nombre: con dos peticiones a la vez al mismo entorno
  recién creado y un certificado que el verificador rechaza de verdad, las dos salen como fallo de
  certificado (el arreglo no deja pasar a ninguna).

Decisiones de Dani (2026-10-11, `[ALCANCE]` del developer):

- Se acepta el arreglo propuesto (en `fetchFor`, la primera petición a cada host de cada sesión va
  sola y las demás de ese host esperan; si falla, la siguiente vuelve a ir sola). CA4 se mantiene
  tal cual en lo que comprueba (con un rechazo real, las dos peticiones lanzadas a la vez salen como
  fallo de certificado), pero su montaje ya no puede exigir que las dos estén en la red a la vez:
  lo adapta el test-writer.
- El hallazgo de «fijada» (la segunda petición podía entrar con el token sin comprobar la huella)
  se cierra en esta ficha; CA2 lo cubre.
- El resto de la caché de Chromium: se intenta cerrar en esta ficha, sin salirse de
  los límites del punto 3. Si no se puede, se anota en «Resultado» y el Planificador escribe una
  ficha de seguimiento de seguridad.
- A Electron no se le abre una issue pública: es un fallo de seguridad y se reporta por su canal
  privado. El informe lo redacta el Orquestador fuera del repositorio y lo envía Dani.
- El repositorio es público: en la ficha, los tests y los comentarios del código queda solo lo
  nuestro (dos conexiones nuevas a la vez al mismo host pueden saltarse el verificador de la app;
  por eso la primera va sola), sin la cadena interna de Electron ni el paso a paso. El detalle va
  solo al informe privado.

## Pruebas a mano para Dani

- Ninguna: con el tenant de pruebas el certificado es de una CA pública y no se usa «ignorar».

## Fuera de alcance

- La 0070 (reparto de `views.spec.ts` y medida de workers): se retoma después de esta ficha y
  repite sus tres pases con 8 workers.
- Cambiar la tabla de decisiones de `tls.ts`, los niveles de certificado o la partición por
  generación (ADR-0003).
- La misma situación en `oauth.ts` (también clasifica `TLS_UNTRUSTED`): si la causa le afecta, se
  anota en «Ideas surgidas» para otra ficha, salvo que el arreglo esté en código común a los dos.

## Ideas surgidas (fuera de alcance)

- (developer) `oauth.ts` usa la misma sesión del entorno, así que el SSO tenía la misma ventana con
  «fijada». El arreglo va en `fetchFor` (código común): le alcanza, sin ficha aparte.
- (developer) Avisar a Electron del fallo. Decidido por Dani: por el canal privado de seguridad de
  Electron, no con una issue pública; lo envía Dani.
- (developer) Ficha de seguimiento de seguridad para lo que queda abierto (ver «Resultado», «Lo que
  queda»): renovar la sesión del entorno antes de que caduque lo que Chromium recuerda, u otra
  salida que Electron ofrezca cuando responda.

## Notas del revisor

### Ronda 1: CAMBIOS

1. [Seguridad y datos] El árbol de HEAD (1c4e612) está limpio (`git grep` no encuentra la cadena interna de Electron), pero los commits intermedios de la rama sí la llevan: `network.verifier-cache.test.ts:9-10` en ad1e0fb…a4ed888, la ficha en 0c21720 y el mensaje de ad1e0fb. Si la rama se sube a una PR, quedarían públicos aunque se fusione con squash. Acción: que lo que se suba no lleve esos commits; comprobar antes del push que lo que se sube no lleva ese detalle (la lista de palabras que se buscan queda fuera del repositorio).

Bien: CA1 (`e2e/inicio-arranque.spec.ts`, «(0079)», `@inicio`, área `tls`; 6/20 en rojo en `main`, 20/20 con el arreglo); CA2 sin tiempos, rojo antes del arreglo; CA3 sin cambios salvo casos añadidos; CA4 solo cambia el montaje (decisión de Dani). `gatedFetch`: no toca `verifyCertificate`, sin reintento, sin `await` entre la comprobación y la asignación de `pending`, `release()` en `finally`, sin interbloqueo (todas las llamadas llevan señal), clave `URL.host` por partición (ADR-0003), cubre `oauth.ts`. El resto de la caché, razonable; el arreglo no empeora nada.

Opcional: comentar en `gatedFetch` que un `Request` con señal propia sin `init.signal` no se respeta mientras espera, y que las que esperan gastan su plazo; en «Lo que queda», «pasado un tiempo» en vez de la duración y la causa.

Nota del Orquestador: el punto 1 lo resuelve la integración del flujo nuevo (ADR-0014): la rama `fix/0079-…` no se sube nunca; a GitHub va solo `integra/…`, con un único commit `merge --squash` (árbol final y mensaje de `integrate.mjs`). Antes del push, el Orquestador comprueba con `git log -p main..integra/…` que no aparecen esos nombres.

### Ronda 2: CAMBIOS

1. [Seguridad y datos] La nota del punto 1 de la ronda 1 dejaba en el árbol final trozos de los nombres internos de Electron (la lista de palabras que había que buscar), contra la decisión de Dani sobre el repositorio público. Acción: quitarlos de la nota; la lista se queda fuera del repositorio. Hecho por el Orquestador en esta misma ronda (era texto suyo).

Bien: el punto 1 de la ronda 1 lo resuelve la integración nueva (`merge --squash` mete solo el árbol final; el mensaje lo hace `buildCommitMessage` con el título y el id; solo se sube `integra/…`), con la condición de que `fix/0079-…` no se suba nunca. Los comentarios de `gatedFetch` (1476142) dicen lo que hace el código; «Lo que queda» (dee73d3) ya no da la duración ni la causa. Criterios y tests sin cambios.

Opcional: «Resultado» y el falso de CA2 explican el mecanismo algo más que la frase que permitió Dani (sin nombrar piezas internas; hacen falta para que CA2 sea determinista y para la ficha de seguimiento); se anuncia en público una ventana que sigue abierta. Se lo comenta el Orquestador a Dani.

### Ronda 3: APROBADO

- Punto 1 de la ronda 2 resuelto (396106d): `git grep -i` sobre HEAD en `src/`, `e2e/` y la ficha no encuentra los nombres internos (solo una palabra de un comentario anterior de `e2e/views.spec.ts`, ajeno a Electron y fuera del diff). La nota de la ronda 1 ya no lleva la lista.
- Desde la ronda 1 solo cambian la ficha y un comentario de `gatedFetch`, que dice lo que hace el código. Tests sin tocar desde 13e5fea/a4ed888: siguen valiendo CA1–CA4.
- Condición: la rama `fix/0079-…` no se sube nunca; solo `integra/…` con el `merge --squash`, comprobado antes del push.
- Opcional (aplicado por el Orquestador, era texto suyo): quitar la duración de la caché de «Decisiones de Dani» y de la nota de la ronda 1.

## Verificación

Tests del test-writer: commit `31547c9` («test(dynatrace): criterios de la ficha 0079 (#0079)»);
CA4 adaptado en `a4ed888` (decisión de Dani).

- CA1 → `e2e/inicio-arranque.spec.ts`, «CA1 (0079): recién arrancada, Inicio carga problemas
  abiertos y SLOs sin «Certificado no de confianza»» (`@inicio`, arnés de vistas, un solo test en
  el spec para que sea siempre el primero de su app). **Antes del arreglo, en `main`, falla 6 de 20**
  con `npm run test:e2e -- e2e/inicio-arranque.spec.ts --repeat-each 20 --workers 4`
  (`kpi-open-problems` se queda en «—»): reproduce en `main`, no hace falta la rama de la 0070. Con
  el arreglo, **20 de 20**. El spec está en los `specs` del área `tls` de `e2e/areas.json`.
- CA2 → `src/main/dynatrace/network.verifier-cache.test.ts` (developer, solo de test): un
  `session.fromPartition` falso en el que una conexión que llega mientras otra al mismo host espera
  al verificador de la app se lleva el resultado de Chromium sin pasar por él; el momento lo fija el
  test, sin tiempos. «ignorar» y certificado propio → las dos entran; «fijada» con la huella del
  certificado propio → las dos entran; «fijada» con un certificado de CA pública y otra huella → las
  dos `TLS_PIN_MISMATCH`; «sistema» → las dos `TLS_UNTRUSTED` (guarda). Sin el arreglo, en rojo los
  tres primeros (`['entra', 'TLS_UNTRUSTED']` y, en el de la huella, `['TLS_PIN_MISMATCH', 'entra']`);
  con él, en verde.
- CA3 → los existentes, sin cambios en lo que esperan: `src/main/dynatrace/tls.test.ts`,
  `network.test.ts`, `client.https.test.ts` y `e2e/tls.spec.ts`. A `network.test.ts` se le añaden
  casos del arreglo («0079: la primera petición a cada host de cada sesión va sola»): las demás
  esperan; si falla, la siguiente va sola y no se reintenta; cada host con su puerto va por su
  cuenta; una sesión nueva vuelve a empezar; abortar mientras se espera.
- CA4 → `src/main/dynatrace/network.concurrent.test.ts` (cliente y red por entorno reales, Chromium
  simulado, dos peticiones lanzadas a la vez sin exigir que estén en la red a la vez): «sistema» con
  certificado propio → las dos `TLS_UNTRUSTED`; «fijada» con otra huella → las dos
  `TLS_PIN_MISMATCH`; «fijada» sin nada fijado → las dos `TLS_UNTRUSTED`; y el rechazo no se
  reintenta (una verificación por petición). En verde antes y después del arreglo.

Verificación 2026-10-11, commit 71d3704, rango `main..fix/0079-tls-inicio-dos-peticiones`: **VERDE**.

- `npm run check`: 213 ficheros, 3710 tests; cobertura: líneas 93,51 %, ramas 90,06 %, funciones 89,83 %.
- e2e afectados, un pase: 364 de 364 (5,9 min).
- CA1: `e2e/inicio-arranque.spec.ts` con `--repeat-each 20 --workers 4`: 20 de 20.
- CA2: con `src/main/dynatrace/network.ts` revertido al de `main`, `network.verifier-cache.test.ts` falla 3 de 4 («ignorar» con certificado propio, «fijada» con la huella fijada y «fijada» con CA pública y otra huella); con el arreglo pasan los 4.
- CA3: `tls.test.ts`, `network.test.ts` y `client.https.test.ts` en verde; `e2e/tls.spec.ts` 16 de 16.
- CA4: `network.concurrent.test.ts` en verde (los 5 ficheros unitarios juntos, 76 de 76).

## Resultado

Commits: tests `ad1e0fb`…`a4ed888`, `13e5fea` y `31547c9`; arreglo `5713f4e`; `e4c8aa7` (área `tls`); comentarios `1476142`. Ficheros principales: `src/main/dynatrace/network.ts` (`fetchFor`), `network.test.ts`, `network.verifier-cache.test.ts`, `network.concurrent.test.ts`, `e2e/inicio-arranque.spec.ts`, `e2e/areas.json`. Rondas de revisión: 3 (APROBADO en la 3). ADR nuevo: ninguno. Sin migraciones.

**Causa (developer, 2026-10-11).** No es del arnés ni de `tls.ts`: dos conexiones nuevas a la vez
al mismo host pueden saltarse el verificador de la app. Al abrir Inicio recién arrancada salen dos
peticiones al mismo entorno a la vez; si la segunda abre su conexión justo mientras la primera
espera la respuesta del verificador, Chromium le da su propio resultado sin preguntar a la app.

- Observado (registro temporal, no commiteado; 4 de 20 en rojo con CA1): en las que pasan, el
  verificador se llama dos veces (una por conexión, las dos aceptan); en las que fallan, una sola,
  y la otra petición recibe de Chromium `net::ERR_CERT_AUTHORITY_INVALID` sin que el verificador
  llegue a llamarse para ella. El cliente la clasifica bien (`ERR_CERT` → `TLS_UNTRUSTED`).
- Por qué «Actualizar» entra: para entonces Chromium ya recuerda la decisión del verificador para
  ese host, y la conexión aceptada sigue abierta para reutilizarse.
- **Hallazgo de seguridad:** con «fijada» y un certificado que Chromium sí acepta (CA pública o de
  empresa) pero con otra huella, la segunda petición podía entrar sin comprobar la huella. Con
  «sistema» no cambia nada (el verificador ya delega en Chromium) y con «ignorar» el SSO va como
  «sistema» o «fijada». CA2 lo cubre.

**Arreglo** (`src/main/dynatrace/network.ts`, `fetchFor`): la primera petición a cada host (con
puerto) de cada sesión va sola; las demás a ese host esperan a que acabe. Si entra, ya van todas a
la vez; si falla, la siguiente vuelve a ir sola. No acepta nada que antes no se aceptase ni
reintenta: cada petición sale una vez y su error es el suyo, así que un rechazo real sigue saliendo
como `TLS_UNTRUSTED` o `TLS_PIN_MISMATCH` (CA4). Una petición que espera y se aborta (por ejemplo,
por tiempo) sale con su aborto, sin llegar a la red. Vale también para el SSO: `oauth.ts` usa el
mismo `fetchFor`. Coste: solo la primera petición a cada host de cada sesión retrasa a las demás,
el tiempo de una petición.

**Lo que queda (el resto de la caché, punto 2 de las decisiones de Dani): no se cierra en esta
ficha.** Chromium recuerda la decisión del verificador para cada host y, pasado un tiempo, la
olvida. Cuando la olvida y la sesión abre a
la vez dos conexiones nuevas al mismo host, la ventana vuelve a abrirse. Desde la app no se ve ni
cuándo la olvida ni cuándo Chromium abre una conexión nueva (las peticiones reutilizan conexiones
abiertas), así que no hay un momento fiable en el que volver a mandar una petición sola. Las salidas
que sí la cerrarían se salen de esta ficha:

- poner en fila todas las peticiones a un host, siempre: una a una por entorno, frena todas las
  vistas;
- renovar la sesión del entorno antes de que Chromium la olvide: cambia cuándo se crea una
  partición nueva (ADR-0003, fuera de alcance), cada sesión nueva se queda en memoria hasta cerrar
  la app, y no cubre todos los casos en los que Chromium la olvida.

Se queda como resto conocido y va a una ficha de seguimiento de seguridad (la escribe el
Planificador; ver «Ideas surgidas»). Lo práctico: la ventana dura lo que tarda el verificador en
responder (milisegundos) y solo pasa con dos conexiones nuevas a la vez justo en ese momento.
