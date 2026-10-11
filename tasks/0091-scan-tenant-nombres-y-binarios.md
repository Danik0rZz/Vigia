---
id: '0091'
titulo: 'scan:tenant mira también los nombres de fichero, los renombrados y los binarios'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: seguridad-revision # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0091-scan-tenant-nombres-y-binarios
adrs: [7] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Dani (2026-10-11, por el Orquestador): los hallazgos de seguridad abiertos de la revisión de código
del 2026-10-11 pasan a fichas con prioridad. Esta es la T-05.

## Especificación

**Hoy.** `scripts/scan-tenant.mjs` solo mira las líneas añadidas de `git diff --unified=0`. No mira:
el nombre de un fichero nuevo o renombrado (un `…/<id>.json` con un valor del tenant en el nombre
pasa), ni el contenido de los binarios (git dice «Binary files … differ»: una captura de pantalla con
la URL del tenant pasa). Hoy los únicos binarios del repositorio son los iconos de `build/`.

**Qué se hace.**

1. **Nombres:** con `git diff --name-status -z <rango>`, cada ruta añadida, modificada o renombrada
   (también el destino de un renombrado) se compara con los valores del `.env`, como las líneas. Un
   hallazgo nuevo de tipo «nombre de fichero», que dice el fichero y nunca el valor.
2. **Binarios:** un binario añadido o modificado (`git diff --numstat` con `-` en las dos columnas)
   fuera de `build/**` hace fallar el escaneo con código 2 («no se ha podido comprobar»), salvo con
   `VIGIA_SCAN_ALLOW_BINARY=1`; el mensaje lo dice. Es la opción más simple y más dura: un binario no
   se puede leer de forma fiable (un xlsx es un zip), así que se trata como sospechoso. Con la
   variable, se busca igualmente en su contenido como texto `latin1` y UTF-16LE (lo que se pueda ver).
3. Lo de hoy no cambia: falla cerrado sin `.env`, con `.env` vacío o con un error de git, y nunca
   imprime valores. `docs/flujo.md` («Puertas sin IA») y el README explican lo nuevo y la variable.

## Carril

Normal (`ligera: no`), con la exclusión `seguridad` (el filtro del tenant): va sola en su PR y la
fusiona Dani.

1. No añade componentes, funciones ni cálculos nuevos: no se cumple; añade dos comprobaciones.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: no se cumple; cambia la lógica del escáner.
4. No hay ninguna decisión que preguntar a Dani: se cumple; la opción del punto 2 la propuso el
   Planificador y Dani la aprobó con el lote (2026-10-11).

## Criterios de aceptación

Todos con un repositorio temporal y un `.env` de prueba con valores inventados.

- CA1: un fichero nuevo cuyo nombre lleva un valor del `.env` da 1 y el mensaje nombra el fichero sin
  el valor. Test con «CA1 (0091)».
- CA2: un renombrado hacia un nombre con un valor del `.env` da 1. Test con «CA2 (0091)».
- CA3: un binario nuevo fuera de `build/` da 2; dentro de `build/`, no. Test con «CA3 (0091)».
- CA4: con `VIGIA_SCAN_ALLOW_BINARY=1`, un binario sin valores pasa y uno que lleva un valor (en
  `latin1` o en UTF-16LE) da 1. Test con «CA4 (0091)».
- CA5: los tests de la 0055 (falla cerrado, nunca imprime valores) siguen en verde sin cambiar lo que
  esperan.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Leer dentro de los zip (xlsx, docx): con la variable, el autor responde de ese fichero.
- El destino del push (ficha 0088).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
