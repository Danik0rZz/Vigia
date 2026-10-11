---
id: '0079'
titulo: 'Bug: al abrir Inicio recién arrancada, con el nivel «ignorar», una de las dos peticiones puede salir como «Certificado no de confianza»'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
