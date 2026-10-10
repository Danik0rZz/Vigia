---
id: '0055'
titulo: '`scan:tenant` falla cerrado: sin `.env.live.local` no da verde, y escanea lo que de verdad se sube'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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

**Tests (test-writer, 2026-10-10):** commit `52b4de6`. Comprobado antes que el fallo sigue en
`main` (`c5d715c`): `scan-tenant.mjs`, `notify-telegram.mjs` y `.githooks/pre-push` no han cambiado
desde `e32e162`. 26 tests nuevos fallan por falta del código; los que ya había siguen pasando (el
antiguo «sin .env termina en 0» se ha quitado: CA1 lo invierte). Todo con repositorios y `.env`
inventados en carpetas temporales; el CI no tiene `.env.live.local` ni lanza `scan:tenant`, así que
no se pone rojo por esto.

| Criterio | Tests                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `scripts/scan-tenant.test.ts` › `CA1 (0055): …` (código 2 y mensaje con `.env.live.local`; con la variable a `1`, 0 y `AVISO` por stderr; con `0`, vacío o `true`, 2; también en `--pre-push`) |
| CA2      | `scripts/scan-tenant.test.ts` › `CA2 (0055): …` (`scan` y CLI desde un worktree real de `git worktree add`) y `scripts/lib/env-file.test.ts` › `CA2 (0055): findLiveEnv …`                     |
| CA3      | `scripts/scan-tenant.test.ts` › `CA3 (0055): …` (`prePushRanges`, CLI `--pre-push` con la entrada estándar y el hook)                                                                          |
| CA4      | `scripts/notify-telegram.test.ts` › `CA4 (0055): …` (importa `findLiveEnv` de `./lib/env-file.mjs`, sin `git worktree list` propio) y los tests de la 0004, que siguen igual                   |
| CA5      | `scripts/scan-tenant.test.ts` › `CA5 (0055): …` (worktree, `--pre-push` y error 2)                                                                                                             |

**Decisiones del test-writer** (Dani las delegó; conservadoras y refinables):

- API: `scripts/lib/env-file.mjs` › `findLiveEnv(cwd, { mainCheckout }?)`, que devuelve la ruta o
  `undefined` y no lanza. `mainCheckout` es opcional y sustituye a git: hace falta para que los
  tests de notify-telegram (que inyectan `deps.mainCheckout`) sigan pasando.
- Pre-push: el hook llama a `node scripts/scan-tenant.mjs --pre-push`, y el script lee los pares
  de la entrada estándar (formato de git: `<ref local> <sha local> <ref remota> <sha remota>`).
  La lógica va en `prePushRanges(entrada)`, exportada: así CA3 es unitario sin ejecutar `sh`.
- Solo `VIGIA_SCAN_TENANT_OPTIONAL=1` exacto lo hace opcional; cualquier otro valor sigue
  fallando.
- Sin fijar (la ficha no lo dice): qué hacer con una línea de borrado de rama (`sha local` a
  ceros) y con una entrada vacía. Lo decide el developer y lo anota aquí.

## Resultado

(pendiente)
