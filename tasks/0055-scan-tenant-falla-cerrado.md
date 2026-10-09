---
id: '0055'
titulo: '`scan:tenant` falla cerrado: sin `.env.live.local` no da verde, y escanea lo que de verdad se sube'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: auditoria-publicacion
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0055-scan-tenant-falla-cerrado
adrs: [7]
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 0
---

## Petición original

Lote «auditoria-publicacion» (0055 y 0056), de una revisión de código hecha el 2026-10-09 sobre
`main` en `e32e162` (hallazgo S-01, impacto **alto**). Dani pidió abordarla (2026-10-10). La
revisión no se guarda en el repositorio: esta ficha lleva todo lo necesario.

## Especificación

**El problema (comprobar que sigue igual en `main`):**

- `scripts/scan-tenant.mjs` busca `.env.live.local` solo en el directorio desde el que se ejecuta.
  Si no está, escribe «sin .env.live.local: no hay nada que buscar» y **sale con 0**, y el
  `pre-push` (`.githooks/pre-push`) lo toma por verde. Hay varios worktrees (el checkout principal y
  los de Orca): un push desde un worktree sin ese fichero pasaría sin escanear.
- `scripts/notify-telegram.mjs` ya tiene una alternativa (`mainCheckout()`: primer worktree de
  `git worktree list`); `scan-tenant` no la usa.
- El hook escanea siempre `origin/main..HEAD` en vez de los refs que git le pasa por la entrada
  estándar al `pre-push`.

Un control de seguridad tiene que **fallar cerrado**: si no puede comprobar, para y lo dice.

**Arreglo:**

1. Una función común (por ejemplo `scripts/lib/env-file.mjs` › `findLiveEnv(cwd)`) que prueba el
   `cwd` y, si no está, el checkout principal (`git worktree list --porcelain`, primera entrada).
   La usan `scan-tenant.mjs` y `notify-telegram.mjs`.
2. En `scan-tenant.mjs`, «sin .env» es **fallo** (código 2, mensaje claro), salvo con
   `VIGIA_SCAN_TENANT_OPTIONAL=1` (pensado para clones sin tenant de pruebas), que sale con 0 y un
   aviso. En la VPS el fichero siempre existe.
3. El `pre-push` lee de la entrada estándar los pares `local_sha remote_sha` y escanea
   `remote_sha..local_sha`; si la rama remota no existe (`remote_sha` a ceros), cae a
   `origin/main..<local_sha>`.
4. Nunca se imprimen valores del `.env` (como hoy).
5. Documentar `VIGIA_SCAN_TENANT_OPTIONAL` en el README y en `docs/flujo.md` (doc-writer).

## Criterios de aceptación

- CA1 (unitario): sin fichero y sin la variable → código 2 y el mensaje; sin fichero y con
  `VIGIA_SCAN_TENANT_OPTIONAL=1` → 0 con aviso.
- CA2 (unitario): con el fichero solo en el checkout principal y el `cwd` en otro worktree
  (simulado), lo encuentra y escanea.
- CA3 (unitario): con pares de refs por la entrada estándar, el rango escaneado es
  `remote..local`; con `remote` a ceros, `origin/main..local`.
- CA4 (unitario): `notify-telegram.mjs` usa la función común y sus tests siguen pasando.
- CA5 (unitario): ninguna salida contiene un valor del `.env` de prueba (inventado).

## Pruebas a mano para Dani

(ninguna)

## Fuera de alcance

- Buscar otros datos además de los del `.env` (nombres de clientes).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
