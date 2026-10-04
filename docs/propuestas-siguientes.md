# Propuestas para después de la 0.8.1

Fichas para que Dani decida qué viene después. Ninguna se empieza sin su visto bueno. Los datos de
la API salen de `docs/notas-api-v2.md` (lo observado en vivo) y de las OpenAPI de `..\API\` (lo
que dice la especificación). Aquí no va ningún dato del tenant.

Cada ficha tiene los mismos apartados: qué aporta al usuario, API y endpoints, scopes, esfuerzo,
riesgos y dependencias, y decisiones que necesita de Dani. Esfuerzo: **S** (un bloque pequeño, sin
canales IPC nuevos o con uno), **M** (una vista o un módulo nuevo acotado), **L** (varias vistas,
canales y pruebas nuevas, o una pieza de infraestructura).

## 1. Vista de Entidades

- **Qué aporta al usuario:** un explorador por tipo de entidad (servicios, hosts, process groups,
  aplicaciones, clústeres de Kubernetes…), con la tabla de entidades del tipo elegido, sus
  `properties` y sus relaciones navegables (de un servicio a su host o a su process group). Es la
  base de la futura Topología del menú.
- **API y endpoints:** Environment API v2 (bloque b de las notas).
  - `GET /entityTypes`: el catálogo de tipos (`types`, con `displayName`, `properties` y
    relaciones de cada tipo).
  - `GET /entities`: exige `entitySelector` (sin él, 400). `fields` añade `properties`, `tags`,
    `managementZones` y las relaciones. La página 2 va solo con `nextPageKey` (con `fields`, 400;
    observado).
  - `GET /entityTypes/{type}`: la definición de las claves de `properties`, que cambian según la
    tecnología de cada entorno.
- **Scopes:** token clásico `entities.read`; OAuth `environment-api:entities:read`.
- **Esfuerzo: L.** Son varias piezas nuevas: canales IPC, la lista de tipos, la tabla paginada,
  el panel de `properties`, la navegación por relaciones y el simulador de los e2e.
- **Riesgos y dependencias:**
  - En el tenant explorado, la mayoría de los tipos son personalizados o de extensión: la interfaz
    tiene que separarlos de los estándar o la lista no se puede usar.
  - Las claves de `properties` no son fijas: hay que mostrarlas de forma genérica, no con columnas
    por tipo.
  - Un selector amplio puede devolver muchas entidades: hace falta el mismo aviso de "Mostrando N de
    M" que en Problemas.
  - Pide un scope que Vigía hoy no usa: la comprobación de "Probar conexión" tendría que añadirlo.
- **Decisiones que necesita de Dani:**
  - Qué tipos se muestran de entrada (solo los estándar, o también los personalizados aparte).
  - Si la navegación por relaciones entra en la primera versión o se deja para la Topología.
  - Si se añade `entities.read` a los scopes que Vigía pide y comprueba.

## 2. Eventos en el detalle del problema

- **Qué aporta al usuario:** en el panel lateral del problema, una sección con los eventos que lo
  componen (tipo, título, estado, inicio y fin), sin vista nueva de Events.
- **API y endpoints:** Environment API v2.
  - `GET /problems/{problemId}` con `fields=+evidenceDetails`, que el detalle ya pide. Según la
    OpenAPI (`EventEvidence`), las evidencias de tipo `EVENT` traen `eventId` y el evento completo
    en `data`, sin peticiones nuevas.
  - **`correlationId` no sirve como enlace:** en la exploración (bloque e) todos los eventos lo
    traen, pero no coincidió con el `problemId` de ningún problema de las mismas 24 h. El filtro
    `correlationId(…)` de `/events` existe, pero la OpenAPI no lo relaciona con los problemas.
  - **La alternativa por `evidenceDetails` no está comprobada en vivo.** Antes de hacer la
    interfaz, una prueba de solo lectura tiene que confirmar la forma de esas evidencias.
- **Scopes:** los del detalle de hoy: token clásico `problems.read`; OAuth
  `environment-api:problems:read`. Si un día se pidiera `/events` aparte, `events.read` /
  `environment-api:events:read`.
- **Esfuerzo: S.** Los datos ya llegan con el detalle. Es una prueba en vivo, un esquema tolerante
  y una sección del panel.
- **Riesgos y dependencias:**
  - Depende de que la prueba en vivo confirme lo que dice la OpenAPI. Si no, habría que buscar otro
    enlace, y eso cambia el esfuerzo.
  - Los títulos y propiedades de los eventos son datos del cliente: solo en pantalla, nunca en
    notas ni en tests.
- **Decisiones que necesita de Dani:**
  - Si se hace la prueba en vivo de `evidenceDetails` (solo lectura, como las demás).
  - Qué campos del evento enseñar en el panel.

## 3. Agrupar Problemas por clúster

- **Qué aporta al usuario:** ver los problemas agrupados por clúster de Kubernetes, con el número
  de cada grupo, en lugar de solo la columna "Clúster" y el filtro que hay hoy.
- **API y endpoints:** ninguno nuevo. Se agrupa en local sobre lo ya cargado: el clúster sale de las
  entidades afectadas e impactadas (`k8s.cluster.*`), como en la columna actual.
  - `problemSelector` no puede filtrar por clúster (400, observado), así que el grupo no se puede
    pedir a la API.
- **Scopes:** los de Problemas: `problems.read` / `environment-api:problems:read`.
- **Esfuerzo: S.** Es una presentación nueva de las filas que ya hay, con su exportación.
- **Riesgos y dependencias:**
  - Un problema con varios clústeres aparecería en varios grupos: hay que decidir cómo contarlo.
  - Con la lista recortada (500 problemas como máximo), los números de cada grupo son de lo cargado,
    no del total: hace falta el mismo aviso que con el filtro.
  - En su día peticiones decidió "columna y filtro, sin agrupar": esta ficha lo reabre.
- **Decisiones que necesita de Dani:**
  - Si se agrupa o basta con el filtro de hoy.
  - Qué hacer con los problemas sin clúster y con los de varios.

## 4. Fase 8: DQL y Logs

- **Qué aporta al usuario:** un editor DQL con tabla de resultados sobre Grail (logs, eventos,
  métricas…), con los bytes escaneados a la vista. Es la Fase 8 de la especificación.
- **API y endpoints:** Platform API, `Grail DQL Query API.yaml`, base `/platform/storage/query/v1`.
  - `POST /query:execute` y `GET /query:poll` (consulta larga), `POST /query:cancel`; y
    `/query:verify`, `/query:parse` y `/query:autocomplete` para el editor.
  - Límites de la petición: `defaultScanLimitGbytes` (-1 es sin límite), `maxResultRecords` (1000
    por defecto), `maxResultBytes` y `requestTimeoutMilliseconds`. La respuesta trae
    `scannedBytes`. La propia spec avisa de que la API no es para exportaciones grandes.
- **Scopes:** solo OAuth o platform token: `storage:logs:read`, `storage:buckets:read` y, según lo
  que se consulte, `storage:events:read`, `storage:metrics:read`, `storage:entities:read`,
  `storage:spans:read` o `storage:bizevents:read`. Con token clásico no hay DQL, y en Managed no
  hay plataforma.
- **Esfuerzo: L.** Editor, adaptador del rango temporal de plataforma, cliente de consulta larga
  (execute, poll y cancel), tabla de resultados, límites por entorno y pruebas con un simulador.
- **Riesgos y dependencias:**
  - **Coste:** Grail factura por GiB escaneado. La especificación ya fija las reglas: la consulta
    solo se lanza por acción explícita (sin auto-refresco ni al abrir la página) y siempre con
    límite de escaneo y de registros, configurable por entorno.
  - Necesita credenciales de plataforma (OAuth o platform token) en el entorno; los entornos solo
    con token clásico o Managed no la tendrían.
  - Encaja con dos cosas aplazadas a esta fase: las exportaciones grandes en streaming (con
    progreso y cancelación) y el aviso de filas de Excel en CSV (1.048.576 por hoja), que con el
    límite actual del IPC no se puede alcanzar.
- **Decisiones que necesita de Dani:**
  - Los límites por defecto (GiB de escaneo y registros) y si cada entorno puede cambiarlos.
  - Si entra el streaming de exportaciones en la misma fase o después.
  - Con qué entorno de plataforma se hace la aceptación manual (una consulta real escanea bytes y
    tiene coste).

## 5. CI en GitHub Actions

- **Qué aporta al usuario:** que cada push a `main` pase `check` y los e2e en Windows sin depender
  de que una sesión los lance, y que una regresión se vea en el repositorio.
- **API y endpoints:** ninguno de Dynatrace. Un workflow en `.github/workflows/` sobre
  `windows-latest`:
  - Instalación como en el README: `npm ci --ignore-scripts` y después `npx install-electron` (sin
    ese paso, los workers de Playwright se pisan al descargar Electron).
  - `npm run check` y `npm run test:e2e`; si se quiere, `dist:win` solo como prueba de que empaqueta,
    sin publicar nada.
- **Scopes:** ninguno. **Sin `test:live` y sin secretos en el CI:** las pruebas en vivo solo se
  lanzan en local con `.env.live.local`.
- **Esfuerzo: S.** Un fichero de workflow y una prueba en una rama.
- **Riesgos y dependencias:**
  - Minutos de Actions de la cuenta: en un repositorio público los runners estándar no suelen
    consumir minutos de pago, pero hay que confirmarlo en la cuenta antes.
  - El repositorio es público: los logs del CI también. No pueden llevar nada del tenant (hoy ningún
    test lo usa fuera de `test:live`).
  - Los e2e con interfaz en un runner sin escritorio pueden necesitar ajustes (tiempos o pantalla).
- **Decisiones que necesita de Dani:**
  - Si se activa el CI y en qué eventos (push a `main`, pull requests o ambos).
  - Si `dist:win` entra en el CI o se queda en local.

## 6. Fusible de integridad del asar

- **Qué aporta al usuario:** que el ejecutable empaquetado compruebe que su `app.asar` no se ha
  modificado, con el fusible `enableEmbeddedAsarIntegrityValidation` de Electron.
- **API y endpoints:** ninguno de Dynatrace. Configuración de fusibles en el empaquetado
  (`electron-builder`).
- **Scopes:** ninguno.
- **Esfuerzo: S.** Es una línea de configuración y una comprobación del zip.
- **Riesgos y dependencias:**
  - Solo afecta al zip: los e2e corren sobre `out/` y no lo prueban. Hace falta arrancar el zip.
  - Ese arranque necesita un perfil de Windows o una máquina virtual de prueba: nunca el perfil de
    Dani ni su `%APPDATA%\vigia`.
  - Si el fusible se activa mal, la app empaquetada no arranca: hay que probarlo antes de dar un
    zip a nadie.
- **Decisiones que necesita de Dani:**
  - Qué perfil o máquina virtual se usa para arrancar el zip.
  - Si se activa en la siguiente versión o se deja anotado.

## Resumen

| Propuesta                        | Esfuerzo | Coste o riesgo principal                                        | Dependencia                                    |
| -------------------------------- | -------- | --------------------------------------------------------------- | ---------------------------------------------- |
| 1. Vista de Entidades            | L        | Muchos tipos personalizados y `properties` sin forma fija       | `entities.read` en el token                    |
| 2. Eventos en el detalle         | S        | El enlace por `evidenceDetails` no está comprobado en vivo      | Una prueba en vivo de solo lectura             |
| 3. Agrupar Problemas por clúster | S        | Problemas con varios clústeres y números de una lista recortada | Reabrir la decisión de "sin agrupar"           |
| 4. Fase 8: DQL y Logs            | L        | Coste por GiB escaneado en Grail                                | Credenciales de plataforma (no hay en Managed) |
| 5. CI en GitHub Actions          | S        | Minutos de Actions y logs públicos                              | Confirmar los minutos de la cuenta             |
| 6. Fusible del asar              | S        | Un zip que no arranca si se configura mal                       | Un perfil o una máquina virtual de prueba      |

Orden sugerido (es una sugerencia, decide Dani): primero el CI, que protege todo lo demás y es
pequeño; después los eventos del detalle y la agrupación por clúster, que usan datos que ya llegan;
el fusible cuando haya dónde arrancar el zip; y al final Entidades y DQL, que son grandes y la
segunda tiene coste.
