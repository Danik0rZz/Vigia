---
id: '0056'
titulo: 'CI: acciones fijadas por SHA, npm audit, artefactos de e2e fallidos, sin cancelar runs y caché de Electron'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: auditoria-publicacion
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0056-ci-endurecido
adrs: [7]
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 0
---

## Petición original

Lote «auditoria-publicacion» (0055 y 0056), de la revisión de código del 2026-10-09 (hallazgos S-04,
S-05, M-07 y M-14). La revisión no se guarda en el repositorio: esta ficha lleva lo necesario.

## Especificación

**Decisión (S-05):** Dani delegó en el Planificador (2026-10-10, "tomas la decisión tú"): `npm audit`
en el CI y una revisión semanal programada, **sin Dependabot** (abre PRs y el flujo no trabaja con
PRs).

Todo en `.github/workflows/` y su test (`scripts/ci-workflow.test.ts`):

1. **Acciones fijadas por SHA (S-04).** Hoy `actions/checkout@v7` y `actions/setup-node@v7`: una
   etiqueta la puede mover el dueño de la acción o quien le robe la cuenta. Pasan a
   `uses: actions/checkout@<sha de 40 hex> # v7.x.y` (igual `setup-node` y las acciones nuevas). El
   SHA se saca con `git ls-remote https://github.com/actions/<acción> refs/tags/v7.x.y`, apuntado
   en el test. El test exige 40 hexadecimales y lee la versión mayor del comentario.
2. **`npm audit` (S-05).** En `ci.yml`, tras instalar: `npm audit --omit=dev --audit-level=high`
   **bloqueante** (lo que va dentro del zip) y `npm audit --audit-level=critical` con
   `continue-on-error: true` (desarrollo, para ver el ruido). Un workflow nuevo `audit.yml` con
   `schedule` semanal y `workflow_dispatch` que ejecuta lo mismo. La nota de vulnerabilidades de
   `docs/ARCHITECTURE.md` pasa a decir que la mantiene el CI (doc-writer). Si el bloqueante sale
   rojo hoy por una vulnerabilidad conocida y no alcanzable (la de `uuid` que arrastra ExcelJS está
   documentada así), se anota la excepción con su motivo en vez de bajar el nivel.
3. **Artefactos de e2e fallidos (M-07).** `e2e/failure-capture.ts` ya deja captura y log en
   `test-results/`, pero el CI no los guarda. Tras `npm run test:e2e`, `actions/upload-artifact`
   (fijada por SHA) con `if: failure()`, `path: test-results/` y `retention-days: 7`. Los e2e usan el
   simulador, sin datos del tenant.
4. **No cancelar runs (M-14a).** `cancel-in-progress: true` cancela el CI de una ficha cuando llega
   el push de la siguiente en una cola, y el enlace del aviso de Telegram apunta a un run cancelado.
   Pasa a `cancel-in-progress: false` (los runs se encolan).
5. **Caché de Electron (M-14b).** `npx install-electron` descarga unos 100 MB en cada run.
   `actions/cache` (por SHA) sobre la caché de Electron del runner, con clave por sistema y versión
   de Electron de `package.json`.

## Criterios de aceptación

- CA1 (unitario): `ci-workflow.test.ts` exige SHA de 40 hexadecimales con comentario `# vX.Y.Z` en
  todas las acciones de los workflows, y la mayor esperada.
- CA2 (unitario): `ci.yml` tiene el `npm audit` bloqueante de producción y el no bloqueante de
  desarrollo; `audit.yml` tiene `schedule` y `workflow_dispatch`.
- CA3 (unitario): `ci.yml` sube `test-results/` solo si falla, con retención de 7 días.
- CA4 (unitario): `concurrency.cancel-in-progress` es `false` y hay un paso de caché de Electron con
  la versión en la clave.
- CA5 (verifier): el CI del push sale en verde (lo comprueba el Orquestador con el enlace).

## Pruebas a mano para Dani

- Ver en GitHub (pestaña Actions) que el workflow semanal aparece y se puede lanzar a mano.

## Fuera de alcance

- Dependabot y PRs automáticos. Firmar el zip.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
