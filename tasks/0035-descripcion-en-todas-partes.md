---
id: '0035'
titulo: 'Problemas: la descripción del evento con formato en todas las evidencias, y medir las descripciones largas'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: markdown
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0035-descripcion-en-todas-partes
adrs: [2, 8]
adr_nuevo:
api: v2, `GET /problems` y `GET /problems/{problemId}?fields=evidenceDetails` (ya en uso); `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `problems.read`.
migracion: no
rondas_revision: 0
---

## Petición original

Lote «markdown» (0035, 0038 y 0043). Dani (2026-10-09): "En el apartado de problemas, cuando consultamos
los detalles del problema, todo `properties.event.description` se debe presentar como en nuestro
visor de markdowns." Dio como ejemplo un problema del tenant de pruebas (su id no se copia aquí)
con una descripción larga: títulos, listas con marcas de verificación, código en línea y un bloque
de código YAML.

## Especificación

**Decisiones de Dani (2026-10-09), al aprobar:** el HTML de formato de las descripciones se
interpreta con lista blanca (ficha 0043, "la fuente es fiable, pondremos los controles"); Dani ha
añadido `VIGIA_LIVE_PROBLEM_ID` en los dos `.env.live.local` (checkout principal y worktree del
Orquestador) con el problema de su ejemplo.

**Hoy** (fichas 0001 y 0002): solo las evidencias `EVENT` sacan `dt.event.description` a su sección
«Descripción» con Markdown, recortada a `MAX_DESCRIPTION_LENGTH` = 5 000 (la máxima medida entonces
era de 245 caracteres). En las demás evidencias la clave se queda como texto en las propiedades.

**1. Medir otra vez (en vivo, solo lectura).** El ejemplo de Dani es mucho más largo que lo medido.
Se amplía `problems-event-description.live.test.ts` (o uno nuevo): problemas de los últimos 30 días,
hasta 50 detalles, y además, **si `.env.live.local` trae `VIGIA_LIVE_PROBLEM_ID`**, ese problema
(la línea la añade Dani; el agente nunca lee ni escribe ese fichero). El informe guarda solo
comportamientos:

- en qué tipos de evidencia y en qué campo llega `dt.event.description` (o claves parecidas con
  Markdown: `description` de otros sitios de `evidenceDetails`);
- longitudes (mínima, mediana, máxima y tramos hasta más de 20 000);
- rasgos: títulos, listas, marcas como ✓ ✗ ⚠, código en línea, bloques de código y su lenguaje
  (`yaml`, `json`…), tablas, citas, avisos de GitHub (`> [!NOTE]` y demás), HTML en crudo (solo los
  nombres de etiqueta, para saber si hay colores con `<span style>` o `<mark>`) y `==resaltado==`.

**2. Límite.** `MAX_DESCRIPTION_LENGTH` se fija con la regla de la 0001 (el doble de la máxima
observada, redondeado al millar, mínimo 5 000) pero con **techo de 20 000** (el del canal
`app:copyText`). Si la máxima pasa de 20 000, se queda en 20 000 con la nota de recorte, y se anota.

**3. En todas las evidencias.** Main saca `dt.event.description` a `description` en **cualquier**
tipo de evidencia que la traiga (no solo `EVENT`), y la interfaz la pinta con su sección
«Descripción» (Markdown, «Copiar» y nota de recorte) en el detalle desplegado de todas. Si la
medición encuentra Markdown en otro campo de `evidenceDetails`, se pinta igual y se anota.

## Criterios de aceptación

- CA1 (live, solo lectura): el informe trae lo del punto 1 sin ids, nombres ni textos; usa
  `VIGIA_LIVE_PROBLEM_ID` si existe. Se salta sin `.env.live.local`.
- CA2 (unitario, shared): `MAX_DESCRIPTION_LENGTH` está entre 5 000 y 20 000.
- CA3 (unitario, main): una evidencia `METRIC`, `TRANSACTIONAL` u otra con `dt.event.description`
  la trae en `description` y la clave sale de las propiedades genéricas.
- CA4 (e2e): en el simulador, una evidencia que no es `EVENT` con descripción en Markdown enseña la
  sección «Descripción» renderizada al desplegarla.
- CA5 (e2e): una descripción de 12 000 caracteres con un bloque de código llega entera (si el
  límite elegido lo permite) y se renderiza.

## Pruebas a mano para Dani

- Abrir el problema del ejemplo y comprobar que la descripción sale entera y con formato.

## Fuera de alcance

- La capa visual nueva del visor (0038).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

**Tests (test-writer, 2026-10-09)**, commit `a66d00e`:

- CA1 → `src/main/modules/problems-description-everywhere.live.test.ts`, «CA1 (0035): medición
  en vivo de las descripciones» (30 días, hasta 50 detalles y el problema de
  `VIGIA_LIVE_PROBLEM_ID`, leído con `loadLiveProblemId` de `src/test/live-env.ts`). Informe en
  `live-reports/problems-description-everywhere.json` (ignorado), solo comportamientos.
- CA2 → `src/shared/problem-evidence-description.test.ts`, «CA2 (0035): MAX_DESCRIPTION_LENGTH
  está entre 5 000 y 20 000» (además, múltiplo de 1 000 y aceptado en una evidencia `METRIC`).
- CA3 → `src/main/modules/problems-description-everywhere.test.ts`, «CA3 (0035)» (`METRIC`,
  `TRANSACTIONAL`, `AVAILABILITY_EVIDENCE`, `MAINTENANCE_WINDOW` y un tipo desconocido; sin la
  clave o con valor vacío, `null`).
- CA4 → `e2e/views.spec.ts`, tres «CA4 (0035)» sobre P-835 (`METRIC` y `AVAILABILITY_EVIDENCE` con
  descripción renderizada; `METRIC` sin descripción, sin sección).
- CA5 → `e2e/views.spec.ts`, «CA5 (0035) … (Transacción con descripción larga)» y «… (Evento con
  descripción larga)»: 12 000 caracteres con un bloque YAML; si `MAX_DESCRIPTION_LENGTH` ≥ 12 000
  llega entera (marca final y sin nota de recorte), si no, nota de recorte.

Ejecución: CA3 falla en 9 de 12 (`description` llega `null` y la clave sigue en las propiedades);
CA4 (con descripción) y CA5 (`TRANSACTIONAL`) fallan porque no hay sección «Descripción»; CA2, CA4
sin descripción y CA5 en `EVENT` ya pasan con el código de hoy (el límite actual, 5 000, está en el
rango, y el `EVENT` va por la rama del recorte). CA1 pasa en vivo (51 peticiones, solo lectura).

**Decisiones del test-writer (Dani delegó; refinables):**

- La OpenAPI v2 solo documenta `data` (con `properties[]`) en `EventEvidence`. Para las demás
  evidencias, los fixtures ponen `dt.event.description` en el mismo sitio que en vivo,
  `data.properties[]`.
- En CA5, el resultado depende del límite elegido («si el límite lo permite»): el test importa
  `MAX_DESCRIPTION_LENGTH` de `src/shared/problem-evidence.ts`.

**Medición en vivo (CA1, 2026-10-09), solo comportamientos:**

- La descripción solo llegó en evidencias `EVENT` (las había también `METRIC`, `TRANSACTIONAL` y
  `AVAILABILITY_EVIDENCE`, ninguna con descripción), siempre en `data.properties[]`.
- Longitudes: mínima 27, mediana 162 y **máxima 4 096** (también en el problema indicado). Que la
  máxima sea exactamente 4 096 apunta a un tope de Dynatrace en el valor de la propiedad; con la
  regla de la ficha, el límite saldría en 9 000 (por debajo de 12 000: CA5 iría por el recorte).
- Rasgos: títulos, listas, negrita, marcas ✓, código en línea, bloques `yaml`, tablas, líneas
  horizontales y enlaces; sin HTML en crudo, citas, avisos de GitHub ni `==resaltado==`.
- En `EVENT` hay **otras propiedades con «description» en la clave** (no `dt.*`, posiblemente
  propias del tenant, así que no se nombran) y también traen Markdown. El punto 3 dice que se
  pinten igual; no hay test para ellas porque la ficha no dice qué claves son: queda para el
  developer o el Planificador.

**Decisión del Orquestador (delegada por Dani, refinable), 2026-10-09:** regla genérica, sin nombrar
claves del tenant. En cualquier evidencia, una propiedad cuya clave contenga `description` (sin
distinguir mayúsculas) y no sea `dt.event.description` se pinta como Markdown, igual que la
«Descripción» (mismo componente, mismo límite, «Copiar» y nota de recorte), en su propia sección
con la clave como título, debajo de «Descripción»; y deja de salir como texto plano en la lista de
propiedades. Los tests usan una clave inventada (por ejemplo `custom.description`) y comprueban
también que una clave sin «description» sigue en la lista como texto. Si alguna de esas claves
resulta no ser Markdown en la prueba a mano, se afina la regla.

## Resultado

(pendiente)
