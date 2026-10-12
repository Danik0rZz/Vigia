---
id: '0093'
titulo: 'El log de main tampoco escribe el nombre de usuario de Windows en las rutas'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: seguridad-revision # nombre corto del lote, si la ficha es parte de uno
depende_de: ['0083'] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0093-log-sin-usuario-de-windows
adrs: [] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

Dani (2026-10-11, por el Orquestador): los hallazgos de seguridad abiertos de la revisión de código
del 2026-10-11 pasan a fichas con prioridad. Esta es la P-02. La P-03 (enmascarar lo anidado) es la 0083.

## Especificación

**Hoy.** Los errores del renderer pasan por `maskErrorDetails` (`src/shared/error-report.ts`), que
cambia el nombre de usuario de las rutas por `<usuario>`. El filtro final del log de main
(`maskLogMessage`, `src/main/log-mask.ts`) solo aplica `maskSecrets` (tokens y cabeceras). Así, el log
de main escribe rutas con el usuario: la copia de la base antes de migrar (`src/main/db/backup.ts`
registra la ruta completa al copiar y al borrar copias antiguas) y las pilas de error (rutas del asar
dentro de la carpeta del usuario, porque el zip es portable). El log existe para poder depurar en
equipos ajenos: es un fichero pensado para enviarse.

**Qué se hace.**

1. El filtro final del log enmascara también el usuario en las rutas, en todo lo que ya recorre tras
   la 0083 (textos, `message`, `stack`, `cause`, anidados), con la misma regla que `maskErrorDetails`
   (reutilizarla; no una copia).
2. `backup.ts` registra solo el nombre del fichero de la copia (la carpeta es conocida).
3. `src/main/CLAUDE.md` (regla del log de la 0060) lo dice.

## Carril

Normal (`ligera: no`), con la exclusión `seguridad` (lo que sale en el log): va sola en su PR y la
fusiona Dani.

1. No añade componentes, funciones ni cálculos nuevos: se cumple (reutiliza `maskErrorDetails`).
2. No elimina nada visible para el usuario: se cumple; el log pierde el usuario, que es lo que se busca.
3. No toca datos, API ni lógica: no se cumple; cambia el filtro del log.
4. No hay ninguna decisión que preguntar a Dani: se cumple.

## Criterios de aceptación

- CA1: un `Error` cuya pila lleva `C:\Users\<nombre>\…` sale del filtro con `C:\Users\<usuario>\…`, y
  el original no cambia. Test unitario con «CA1 (0093)».
- CA2: una cadena, un objeto anidado y la `cause` de un error con una ruta de usuario (de Windows y
  `/home/<nombre>/…`) salen enmascarados. Test con «CA2 (0093)».
- CA3: la copia antes de migrar registra el nombre del fichero y no la carpeta. Test con «CA3
  (0093)» en el test de `backup.ts`.
- CA4: los tests de la 0060 y la 0083 siguen en verde sin cambiar lo que esperan.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Otras categorías de datos en el log.

## Ideas surgidas (fuera de alcance)

- Usuario de Windows con espacios y carpeta `OneDrive - <Organización>`: la regla compartida los filtra en parte (pasada a «Propuestas» del BACKLOG, surgió en 0093).
- Comentario de `src/main/logging.ts:21` (pasado a «Mejoras anotadas»).

## Notas del revisor

### Ronda 1: APROBADO

- **Criterios.** CA1 y CA2 (0093) en `src/main/log-mask.test.ts` y CA3 (0093) en `src/main/db/backup.test.ts`, numerados y fallarían con el código anterior. `maskLogMessage` usa `maskErrorDetails` de `@shared/error-report` (sin copiar la regla); `backup.ts` registra `basename` al copiar, al borrar copias antiguas y en el aviso de la copia incompleta. `src/main/CLAUDE.md` lo explica.
- **(1) CA3 de la 0060 (b3ce277):** único cambio a los tests tras 01e43ec; solo fija `cause.stack`, con las mismas expectativas. El motivo es real (la pila pasa por `C:\Users\…`). Los demás tests de la 0060 y la 0083 con pilas reales no comparan identidad. CA4 (0093) se cumple.
- **(2) CA2 de la 0061:** de `toContain(copyPath)` a `toContain(basename(copyPath))`, lo que pide el punto 2; CA4 solo protege la 0060 y la 0083.
- **(3) Parámetros de URL:** aceptable, no es `[ALCANCE]`: la ficha manda reutilizar `maskErrorDetails`, que incluye `SECRET_PARAMS`; el log solo tapa más. El enmascarado es idempotente.
- **(4)** En main solo `backup.ts` registraba rutas completas; el hook cubre todos los transportes y `errorHandler`.

Opcional:

1. [ALCANCE] (no bloquea, para Dani) Un usuario de Windows con espacios se filtra en parte: la clase de `src/shared/error-report.ts:52` se para en el espacio (`C:\Users\Juan Perez\…` queda `C:\Users\<usuario> Perez\…`); lo mismo con `OneDrive - <Organización>` dentro del perfil. Viene de la regla compartida; arreglarlo cambia también el renderer. Ficha aparte si Dani quiere.
2. El comentario de `src/main/logging.ts:21` podría citar la 0093 y las rutas.

## Verificación

Tests escritos en el commit 01e43ec (test-writer); fallan porque el código aún no existe.

- CA1: `src/main/log-mask.test.ts`, «CA1 (0093): la pila de un Error sale sin el usuario de Windows».
- CA2: `src/main/log-mask.test.ts`, «CA2 (0093): cadenas, objetos anidados y cause salen sin el
  usuario» (cadena con ruta de Windows y `/home/…`, objeto anidado con lista, `cause` de texto y
  `cause` Error con su pila).
- CA3: `src/main/db/backup.test.ts`, «CA3 (0093): la copia antes de migrar registra el nombre del
  fichero, no la carpeta» (la copia y, por el punto 2 de la especificación, también la poda de copias
  antiguas). El CA2 de la 0061 del mismo fichero comprobaba que la ruta completa quedaba en el log;
  ahora comprueba el nombre del fichero (`basename`), lo que pide esta ficha.
- CA4: los tests de la 0060 y la 0083 de `src/main/log-mask.test.ts` no han cambiado lo que esperan.
  Arreglo de fixture (decisión del Orquestador): en «un Error: conserva name y cause…» (CA3 de la
  0060), la `cause` tenía la pila real del proceso, que pasa por la carpeta del checkout; bajo
  `C:\Users` la 0093 la enmascara, la `cause` se copia y `toBe(cause)` fallaba según el equipo. Ahora
  `cause.stack` es `'Error: causa'`, sin rutas. Sigue probando lo mismo (una `cause` sin nada que
  enmascarar se conserva por identidad) con las mismas expectativas, así que el CA4 se mantiene.

Verificación 2026-10-12, commit b105071, rango `integra/20261012-4..fix/0093-log-sin-usuario-de-windows`: **VERDE**

- `npm run check`: 4168 tests (226 ficheros), cobertura ok (líneas 93,58 %, ramas 90,03 %, funciones 89,94 %, sentencias 92,83 %).
- `test:e2e:affected`: 369 passed (1,7 min), un pase, sin fallos.
- `core.bare` del checkout principal en `false`.

## Resultado

(developer) Hecho en 778d1cb (filtro), bf94275 (`backup.ts`) y ced2848 (`src/main/CLAUDE.md`).

- `maskLogMessage` usa `maskErrorDetails` (`src/shared/error-report.ts`) en vez de `maskSecrets`
  en textos, `message` y `stack`: la misma regla, sin copia. **Va más allá de lo que pide la ficha
  (lo valora el reviewer):** `maskErrorDetails` también tapa los parámetros de URL que pueden ser
  credenciales (`SECRET_PARAMS`, p. ej. `?token=abc123` → `?token=***`, valor inventado), así que
  el log de main ahora también los tapa. Separarlo obligaría a copiar la regla de las rutas.
- `backup.ts` registra solo el nombre del fichero al copiar y al borrar copias antiguas. Además,
  el aviso «No se pudo borrar la copia incompleta» también lleva solo el nombre (no lo pide la
  ficha; es la misma ruta).
- `npm run check` en verde (4168 tests, cobertura 92,83 %) y `test:e2e:affected -- main..HEAD`:
  369 pasados.

(doc-writer) Commits: 778d1cb, bf94275, ced2848 (código y regla), tests en 01e43ec y b3ce277. Ficheros principales: `src/main/log-mask.ts`, `src/main/db/backup.ts`, `src/main/CLAUDE.md`. Una ronda de revisión (APROBADO). Sin ADR nuevo ni migraciones. Estado `verificada`: pasa a `hecha` al integrarla el Orquestador.
