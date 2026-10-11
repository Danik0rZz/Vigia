---
id: '0092'
titulo: 'El aviso de Telegram no se envía si no se ha podido filtrar el tenant'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad, externos] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: seguridad-revision # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0092-telegram-no-envia-sin-filtro
adrs: [9] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Dani (2026-10-11, por el Orquestador): los hallazgos de seguridad abiertos de la revisión de código
del 2026-10-11 pasan a fichas con prioridad. Esta es la T-07.

## Especificación

**Hoy.** `scripts/notify-telegram.mjs`: sin `.env.live.local` (ni en la carpeta ni en el checkout
principal) o con uno sin valores, avisa de que «no se ha podido filtrar el texto» y **envía
igualmente**. Es el mismo caso que la 0055 cerró en `scan:tenant`, pero hacia un servicio externo. El
test «CA8 (0004)» fija ese comportamiento.

**Qué se hace.**

1. Sin valores con los que filtrar, no se envía: `[aviso telegram] sin .env.live.local con valores:
no se envía`, salvo con `VIGIA_TELEGRAM_UNFILTERED=1` (para un clon sin tenant de pruebas).
2. Sigue saliendo con 0 en todos los casos: el aviso nunca para el flujo (ADR-0009).
3. El test «CA8 (0004)» cambia a lo nuevo (no envía) y se dice en la ficha; `docs/flujo.md` («Avisos
   por Telegram») y el README explican el caso y la variable.

## Carril

Normal (`ligera: no`), con las exclusiones `seguridad` (filtro del tenant) y `externos` (Telegram): va
sola en su PR y la fusiona Dani.

1. No añade componentes, funciones ni cálculos nuevos: se cumple.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: no se cumple; cambia cuándo se envía.
4. No hay ninguna decisión que preguntar a Dani: se cumple.

## Criterios de aceptación

- CA1: sin `.env` en la carpeta ni en el checkout principal, no se llama a la red, sale con 0 y avisa
  sin el token ni el chat. Test con «CA1 (0092)» (sustituye lo que esperaba «CA8 (0004)»).
- CA2: con un `.env` sin valores, lo mismo que CA1. Test con «CA2 (0092)».
- CA3: con `VIGIA_TELEGRAM_UNFILTERED=1` y sin `.env`, se envía y avisa de que va sin filtrar. Test
  con «CA3 (0092)».
- CA4: con un `.env` con valores, lo de hoy no cambia (filtra y, si encuentra algo, no envía): los
  tests de la 0004 siguen en verde.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Recibir órdenes por Telegram (ADR-0010).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
