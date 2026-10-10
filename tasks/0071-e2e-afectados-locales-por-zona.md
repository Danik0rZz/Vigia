---
id: '0071'
titulo: 'test:e2e:affected: un cambio solo en locales/ lanza los unitarios de textos y los e2e de su zona'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: flujo-herramientas # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0067', '0068', '0070'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0071-e2e-afectados-locales-por-zona
adrs: [6, 13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
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

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
