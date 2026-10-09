---
id: '0035'
titulo: 'Problemas: la descripción del evento con formato en todas las evidencias, y medir las descripciones largas'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 1
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
- Con problemas reales, ver que las otras propiedades con «description» (secciones con su clave como título) son de verdad Markdown.

## Fuera de alcance

- La capa visual nueva del visor (0038).

## Ideas surgidas (fuera de alcance)

- (developer) La máxima medida es exactamente 4 096 caracteres, también en el problema del ejemplo
  de Dani: si es un tope de Dynatrace en `evidenceDetails`, la descripción puede llegar ya cortada
  sin que Vigía lo sepa (la nota de recorte no sale). Comprobar en vivo si otro endpoint documentado
  (por ejemplo, el evento por su `eventId`) la trae entera y, si no, avisar de que puede venir
  recortada de origen.

## Notas del revisor

### Ronda 1: APROBADO

CA1 a CA5 y la decisión del Orquestador con su test; `MAX_DESCRIPTION_LENGTH` = 9 000 por la regla
de la 0001 sobre 4 096. Tras `779a22d` solo cambian los dos `toEqual` del wire completo en
`problems.test.ts`, que suman `extraDescriptions: []` por el campo nuevo: legítimo, nada se relaja.
Markdown con `MarkdownText`, sin HTML (ADR-0008); topes en Zod; sin textos nuevos, dependencias ni
migración; misma API. El live no imprime el id de `VIGIA_LIVE_PROBLEM_ID` y comprueba que ni él ni
los textos observados llegan al informe; solo GET. Las propiedades de las evidencias que no son
EVENT ya cruzaban el IPC con su tope; ahora solo se pintan.

Sugerencias, no bloquean:

- Defensa barata: pasar las claves de las propiedades de evidencia por `isHiddenPropertyKey`
  (`entity-secrets.ts`) antes de cortar a 8, con su test (ficha aparte o BACKLOG).
- Con más de 4 claves «description», la quinta y siguientes desaparecen sin aviso: dejarlas como
  texto en la lista o anotarlo como límite conocido.

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
- Decisión del Orquestador (otras claves con «description») → commit `779a22d`:
  - unitario `src/main/modules/problems-description-everywhere.test.ts`, «Decisión del
    Orquestador (0035)»: `custom.description` (METRIC), `Runbook.Description` (EVENT) y
    `descriptionExtra` (TRANSACTIONAL) salen de las propiedades genéricas y su Markdown llega
    entero en el wire, con su clave (sin atarse al nombre del campo); mismo límite
    (`MAX_DESCRIPTION_LENGTH`); `custom.owner` sigue en la lista como texto; con
    `dt.event.description` a la vez, cada una a su sitio.
  - e2e `e2e/views.spec.ts`, dos «Decisión del Orquestador (0035)» en P-835 (ahora con 6
    evidencias): en el METRIC, sección propia con la clave como título, Markdown renderizado,
    «Copiar», fuera de «Descripción» y después de ella; en un EVENT sin `dt.event.description`,
    `Runbook.Description` también se pinta. En los dos, `custom.owner` sigue en la lista. La
    sección se localiza por su título y su contenido, sin `data-testid`.
  - Ejecución: los 6 unitarios y los 2 e2e fallan (la clave sigue en la lista y no hay sección).

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

**Decisiones del developer (Dani delegó; refinables), 2026-10-09:**

- `MAX_DESCRIPTION_LENGTH` = **9 000** (4 096 × 2 = 8 192, redondeado hacia arriba al millar, como
  en la 0001). CA5 va por la rama del recorte.
- Wire: `description` sale en cualquier tipo; las otras claves van en `extraDescriptions`
  (`{ key, text, truncated }`, como mucho `MAX_EXTRA_DESCRIPTIONS` = 4 por evidencia, mismo tope).
  El campo es opcional en el esquema para que el wire de la 0001 (`wireWith`, que usa el CA2) siga
  siendo válido; main lo manda siempre. Los dos `toEqual` del wire completo de `problems.test.ts`
  suman `extraDescriptions: []` (contrato nuevo, no se ablanda nada).
- Una clave con «description» solo se extrae si su valor es texto: con otro tipo sigue en la lista
  como propiedad; con texto vacío no se enseña.
- Interfaz: `EvidenceDescription` con `title` pinta las otras claves (data-testid
  `evidence-extra-description*`, para no confundirlas con la principal). En los tipos que no son
  `EVENT`, debajo de su resumen van las descripciones y, ahora también, sus propiedades genéricas
  (antes solo las enseñaba el `EVENT`); `EvidenceView` gana `properties`, `description` y
  `extraDescriptions` de primer nivel.

### Verifier, 2026-10-09, commit `5b04295`, rango `main..feat/0035-descripcion-en-todas-partes`: VERDE

- check: 2657 tests en 154 ficheros, cobertura ok.
- e2e completo (toca `src/shared`): 303/303.

## Resultado

- Commits: `6254de9` y `01b9060` (código), tests en `a66d00e` y `779a22d`; rango `main..feat/0035-descripcion-en-todas-partes`.
- Ficheros principales: `src/shared/problem-evidence.ts`, `src/main/modules/problems.ts`, `src/renderer/src/components/EvidenceDescription.tsx` y `EvidenceSection.tsx`, más los tests unitarios, el live y `e2e/views.spec.ts`.
- `MAX_DESCRIPTION_LENGTH` = 9 000; campo nuevo `extraDescriptions` (hasta 4 por evidencia) en el wire.
- Rondas de revisión: 1 (aprobada). Verifier en verde (2657 unitarios, e2e 303/303). ADR nuevo: ninguno. Migración: no.
- Pendiente para Dani (a mano): abrir problemas reales y comprobar que las otras propiedades con «description» son de verdad Markdown; si alguna no lo es, se afina la regla.
