# ADR-0003: Una partición de red por entorno y generación

Estado: aceptado (Fase 4, registrado el 2026-10-06)

## Contexto

Cada entorno puede tener su nivel de verificación de certificados y sus huellas aceptadas. Electron
cachea el resultado de `setCertificateVerifyProc` y no hay forma de borrarlo: desde la PR #26517
(2020) volver a llamarlo ya no limpia la caché, y el issue #41448 (pedir esa API) sigue abierto.

## Decisión

Cada cambio de nivel o de huellas de un entorno crea una partición nueva en memoria
`env-<id>-<generación>` (`src/main/dynatrace/network.ts`).

## Alternativas descartadas

- Reutilizar la partición y volver a llamar a `setCertificateVerifyProc`: seguiría aceptando lo que
  ya había aceptado.

## Consecuencias

Cada `reset` deja la sesión anterior en memoria hasta cerrar la app (AUD-21). Es una limitación de
Electron y solo se anota. Fuentes: https://www.electronjs.org/docs/latest/api/session,
https://github.com/electron/electron/pull/26517 y https://github.com/electron/electron/issues/41448.

## Seguimiento: conexiones nuevas a la vez (fichas 0079 y 0095)

Dos conexiones nuevas a la vez al mismo host pueden saltarse el verificador de la app. La 0079
manda sola la primera petición a cada host de cada sesión; pero la sesión olvida, pasado un tiempo,
la decisión del verificador, y la ventana puede volver a abrirse (dura lo que tarda el verificador
en responder).

- **Hosts con huella fijada** (nivel «fijada» con huella para el host, o el SSO con huella): desde
  la 0095 sus peticiones van siempre de una en una (`queuesRequests` en
  `src/main/dynatrace/tls.ts`, aplicada en `gatedFetch` de `network.ts`). Es lo que más importa:
  ahí la decisión depende de la huella, y Chromium solo no la comprueba. Coste: con huella fijada,
  las vistas piden los datos de uno en uno y pueden tardar más (el formulario del entorno lo avisa).
- **Riesgo aceptado (Dani, 2026-10-12):** con «ignorar», en un host del entorno, una petición puede
  salir de vez en cuando con un falso «Certificado no de confianza»; se arregla con «Actualizar».
  No tiene impacto de seguridad: el resultado que se cuela es el de Chromium, que rechaza, nunca
  acepta de más. Con «sistema» y en los hosts sin huella la decisión ya es la de Chromium, así que
  no hay nada que saltarse.
- Se revisa todo esto si Electron responde al aviso privado que se le envió.
