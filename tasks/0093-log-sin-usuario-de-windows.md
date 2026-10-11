---
id: '0093'
titulo: 'El log de main tampoco escribe el nombre de usuario de Windows en las rutas'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
