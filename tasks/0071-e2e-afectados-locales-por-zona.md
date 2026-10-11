---
id: '0071'
titulo: 'test:e2e:affected: un cambio solo en locales/ lanza los unitarios de textos y los e2e de su zona'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: flujo-herramientas # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0067', '0068', '0070'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0071-e2e-afectados-locales-por-zona
adrs: [6, 13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 2
---

## Petición original

ADR-0013, parte 2, A (aprobada por Dani el 2026-10-10): «que un cambio solo en `locales/` lance los
unitarios de textos y los e2e de su zona». En la 0065, cambiar un título lanzó shell, smoke y views:
301 tests.

## Especificación

Hoy `src/renderer/src/locales/**` está en el área `shell`, y `docs/flujo.md` dice que los locales
disparan shell más el área del módulo si el diff toca uno. Los textos viven en dos ficheros,
`locales/es/common.json` y `locales/en/common.json`, con claves de primer nivel por zona (`problems`,
`metrics`, `home`, `entities`…).

**Qué claves han cambiado.** Una función pura, `changedKeys(before, after)`, compara dos JSON de
textos y devuelve las rutas de las hojas añadidas, quitadas o cambiadas (`entities.service.availability.title`).
El script lee la versión del principio del rango (`git show <base>:<ruta>`; si el fichero no existía,
`{}`) y la del árbol de trabajo, en los dos idiomas.

**De la clave a la zona.** `e2e/areas.json` gana una clave `locales`: prefijo de clave → zonas (las de
la ficha 0067). El prefijo es el de primer nivel y, en `entities`, el de segundo (`entities.service` →
`@servicio`, `entities.host` y `entities.disk` → `@host`…). Un prefijo de textos que se usan en
varias zonas (por ejemplo `module`, `export`, `dtErrors`, `errorReasons`) lleva todas las zonas
donde se usan. El mapa sale de buscar en el código dónde se usa cada prefijo (`t('module.`…), no
de suponerlo, y el developer explica el criterio en la propia config o en la cabecera del script.
Gana el prefijo más largo.

**Qué se lanza:**

- **Solo cambian ficheros de `locales/`** (los dos `common.json`, más tests unitarios u otros
  ignorados): los unitarios de textos (`vitest run src/renderer/src/locales`, que incluye la paridad
  es/en y el lint de i18n) y Playwright con los specs de esas zonas, más `smoke`, filtrado con
  `--grep` por las etiquetas de esas zonas y `@smoke` (así, de `views-portapapeles.spec.ts` solo
  corren los tests de esas zonas).
- **Locales y además otros ficheros:** las zonas de los textos suman sus specs a los del resto del
  diff, sin `--grep` (como un área más). Los unitarios de textos ya los pasa `check`.
- **Un prefijo sin zona en el mapa** o un JSON que no se puede leer: e2e completo, con el motivo
  (igual que «sin área»). Nunca menos de lo seguro.
- Se imprime, como hoy, el motivo: `locales: entities.service.availability.title → @servicio`.

`locales/**` sale del área `shell` (el resto de `shell` no cambia). Las opciones de la 0068
(`--no-build`, `-g`, `--last-failed`) siguen funcionando; si llega `-g` de quien lo lanza y además
hay `--grep` de zonas, se combinan los dos (el developer decide cómo y lo prueba).

**Guarda:** cada clave de primer nivel de `es/common.json` (y de segundo en `entities`) tiene prefijo
en `locales`, y cada zona del mapa existe en `zones`. Así, una sección nueva de textos sin mapa falla
en `check` y no lanza en silencio el e2e completo.

**Documentación:** `docs/flujo.md` («Niveles de prueba», la línea de locales y `main.css`) y
`e2e/CLAUDE.md`.

## Carril

Normal (`ligera: no`).

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**, añade `changedKeys`, el
   mapa y la guarda.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: **no se cumple**, cambia la selección de afectados.
4. No hay ninguna decisión que preguntar a Dani: se cumple.

## Criterios de aceptación

- CA1: `changedKeys` da las hojas añadidas, quitadas y cambiadas, con rutas completas, también con
  claves con plural (`_one`, `_other`) y con un fichero que antes no existía.
- CA2: con un diff solo de `entities.service.*` en es y en, el plan lanza los unitarios de textos y
  Playwright con `views-servicio.spec.ts`, `smoke.spec.ts` y el spec del portapapeles solo si la zona
  tiene tests allí, con `--grep` de `@servicio` y `@smoke`; no lanza `shell.spec.ts`.
- CA3: con un diff de un prefijo compartido (por ejemplo `module`), lanza los specs de todas sus
  zonas.
- CA4: con un diff de locales y de un fichero de otra área, salen los specs de las dos, sin `--grep`
  de zonas.
- CA5: con un prefijo que no está en el mapa, o un `common.json` que no es JSON válido, sale el e2e
  completo con el motivo.
- CA6: la guarda pasa sobre los textos reales y falla con un `common.json` de ejemplo que tiene una
  clave de primer nivel sin prefijo, o un prefijo que apunta a una zona que no existe.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- `main.css` y los temas (siguen como hoy).
- Detectar qué tests usan cada clave concreta: se trabaja por zona.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: CAMBIOS

1. [Criterios / seguridad del plan] El mapa `locales` de `e2e/areas.json` deja fuera zonas cuyos tests usan esos textos (incumple «lleva todas las zonas donde se usan» y «nunca menos de lo seguro»). Tres casos reales: `module` sin `@shell` (`module.noEnvironment` se monta en `src/renderer/src/data/modules.ts:61` y lo comprueban `e2e/shell.spec.ts:290` y `:313`); `topbar` sin `@tls` (`e2e/tls.spec.ts:303-318` pulsa el botón por `topbar.language`); `secrets` sin `@vistas-comun` (`e2e/views-vistas-comun.spec.ts:137`, `secrets.configured`). El criterio de la cabecera de `scripts/affected-e2e.cjs:26-40` (zonas de las áreas de cada fichero) no ve claves montadas fuera del componente que las pinta ni tests que pasan por pantallas de otra zona. Acción: corregir los tres prefijos y hacer una pasada sistemática por `e2e/*.spec.ts`: cada valor literal de `common.json` (es y en) y cada `t('es', '…')` que use un test cae en un prefijo que incluya la zona de ese test (descartando a mano coincidencias falsas de fixtures). Añadir ese paso al criterio de la cabecera y a `e2e/CLAUDE.md`. Convertirlo en guarda sería un criterio nuevo (`[ALCANCE]`, opcional, lo decide Dani).

Bien: CA1–CA6 con su `describe` numerado, sin tocar desde ad329e0; quitar los casos «locales solo → shell» y «locales + página → shell y módulo» es correcto. Toda duda da el e2e completo; el prefijo más largo gana con frontera en `.`; la guarda comprueba que las zonas existen. `-g` + zonas: zonas escapadas, `(?![\w-])`, patrón del usuario en grupo no capturante; puede correr más, nunca menos. `rangeBase` correcto con `a..b` y `a...b`. Sin IPC, API, dependencias, esquema, secretos ni datos del tenant.

Opcional: `gitShow` con `${ref}:./${file}`; reflujar una línea partida de `docs/flujo.md` («Transversal»); el JSDoc de `decide` («rutas relativas a app/»).

### Ronda 2: APROBADO

- Nota 1 de la ronda 1 resuelta (cbe1715): `module` con `@shell`, `topbar` con `@tls`, `secrets` con `@vistas-comun`, y los dos de la pasada (`topbar` += `@errors`, por `errors.spec.ts:345` y `:352`; `topbar` += `@tenants`, por `tenants.spec.ts:102`). El criterio (repasar los specs, no solo `src/`) está en la cabecera de `scripts/affected-e2e.cjs` y en `e2e/CLAUDE.md`, como paso, no como guarda.
- La pasada es creíble. Muestreo propio, distinto del de la ronda 1, sin ningún texto sin cubrir: `shell.spec.ts` (`timeRange`, `nav`, `navHelp`); `views-metricas`, `views-host` y `tenants` (referencias `es.`/`en.`); literales de `tls.spec.ts`, `views-monitor`, `views-aplicacion`, `views-vistas-comun`, `views-entidad`, `views-portapapeles` e `inicio-arranque`. Las coincidencias con datos del simulador son las falsas que describe la ficha.
- Opcionales aplicados y correctos (`gitShow` con `./`, «Transversal» reflujado, JSDoc de `decide`).
- Tests sin cambios desde ad329e0; CA2, CA3 y CA6 toman el mapa real y siguen valiendo; CA2 sigue sin lanzar `shell.spec.ts`. Sin secretos ni datos del tenant.

## Verificación

Tests escritos en ad329e0 (`scripts/affected-e2e-locales.test.ts`; en `scripts/affected-e2e.test.ts`
se quita el caso «locales solo → shell», que contradice esta ficha). Contrato que suponen, en la
cabecera del test: `changedKeys(before, after)`, `decide(files, config, texts)` con el texto sin
leer de cada `common.json` (`before` null si no existía), `localeMapProblems(texts, config)` y
`locales` en `e2e/areas.json` (prefijo → etiquetas de `zones`); los specs de una zona son los
de `e2e/` con tests de su etiqueta.

- CA1: `describe('CA1 (0071): changedKeys …')` (añadidas, quitadas, cambiadas, plurales, `{}`).
- CA2: `describe('CA2 (0071): solo textos de entities.service …')` (specs, unitarios, `--grep`,
  motivo, ignorados junto a los textos, `-g` y `--no-build`).
- CA3: `describe('CA3 (0071): un prefijo compartido (module) …')` (y el prefijo más largo).
- CA4: `describe('CA4 (0071): textos y un fichero de otra área …')`.
- CA5: `describe('CA5 (0071): prefijo sin mapa o JSON roto …')`.
- CA6: `describe('CA6 (0071): la guarda del mapa de textos')`.

Ronda 1, nota 1 (developer): pasada por `e2e/*.spec.ts` con un script temporal, sin commitear.
Para cada línea de un spec, la zona es la de su test (las etiquetas de `zones` del bloque `test(`
o `test.describe(` de primer nivel; fuera de un bloque, las de todo el fichero; `@smoke` no
cuenta porque siempre corre). En cada línea busca `t('es'|'en', '…')` (con plantilla, el trozo
fijo), `es.…`/`en.…` y los literales (comillas, plantillas y `/regex/`) iguales a una hoja de
`es/common.json` o `en/common.json` (o a un trozo fijo de una con `{{…}}`), sin títulos de test.
Un literal vale si alguna de las claves con ese texto tiene un prefijo con la zona del test; si
ninguna, se mira a mano. Quedan 220 coincidencias falsas, todas descartadas: nombres de entornos y
del cliente del arnés («Producción», «Desarrollo», «Cliente A › …»), títulos y textos de problemas
y eventos del simulador («Tiempo de respuesta tabla», «Sin datos de evento», «Uso de CPU alto»,
«Pasos» como encabezado de una descripción), métricas del simulador («CPU usage»), `data-testid`
e IDs de canal (`environment-form`, `environments:setActive`, `metric-resolution`), teclas
(`Space`), trozos de expresiones regulares y el mensaje de React Router de `errors.spec.ts`. Los
ayudantes de `e2e/views/` no usan claves de textos. Prefijos cambiados en `e2e/areas.json`:
`module` += `@shell` (`module.noEnvironment`, `shell.spec.ts`); `topbar` += `@tls`
(`topbar.language`, `tls.spec.ts`), `@errors` (`topbar.language`, `errors.spec.ts`, el cambio de
idioma de la pantalla de error) y `@tenants` (`topbar.breadcrumb`, `tenants.spec.ts`); `secrets` +=
`@vistas-comun` (`secrets.configured`, `views-vistas-comun.spec.ts`). Tras el cambio, la pasada no
da ninguna clave (`t`, `es.…`) sin cubrir. El paso queda en la cabecera de
`scripts/affected-e2e.cjs` y en `e2e/CLAUDE.md`.

Verificación 2026-10-11, commit dd08098, rango `integra/20261011-7..feat/0071-e2e-afectados-locales-por-zona`: **VERDE**.

- `npm run check`: 217 ficheros, 3819 tests; cobertura: sentencias 92,74 %, ramas 90,06 %, funciones 89,83 %, líneas 93,51 %.
- e2e, un pase (completo por `e2e/areas.json`): 365 pasados, 0 fallos, 1,4 min.
- Prueba de humo con un cambio real de textos: no se pudo, porque `test:e2e:affected` no tiene un modo que muestre el plan sin ejecutarlo. El comportamiento lo cubren CA2, CA3 y CA6 con el mapa real.

## Resultado

Commits: ad329e0 (tests), a937f80 (script y mapa), 62277e2 (docs de flujo y e2e), cbe1715 (arreglo de la ronda 1) y 5ef30dc (pasada por los specs). Rondas de revisión: 2. ADR nuevo: ninguno. Sin migraciones.

Ficheros principales: `scripts/affected-e2e.cjs` (`changedKeys`, `localeMapProblems`, `decide` con textos), `e2e/areas.json` (clave `locales`; `locales/**` sale de `shell`), `scripts/affected-e2e-locales.test.ts`, `scripts/affected-e2e-grep.test.ts`, `docs/flujo.md` y `e2e/CLAUDE.md`.

Ideas pasadas al BACKLOG (Mejoras anotadas): modo `--plan`/`--dry-run` y guarda automática de la pasada por los specs (esta, pendiente de Dani).
