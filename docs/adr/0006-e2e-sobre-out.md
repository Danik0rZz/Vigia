# ADR-0006: Los e2e corren sobre `out/`, sin empaquetar

Estado: aceptado (Fase 1, registrado el 2026-10-06)

## Contexto

Con los fusibles de Electron activos en el ejecutable empaquetado, Playwright no puede adjuntarse a
la app.

## Decisión

Los e2e prueban la app compilada en `out/` (`npm run test:e2e`), cada uno con su carpeta de datos
(`VIGIA_USER_DATA_DIR`, solo sin empaquetar). El zip se comprueba generándolo (`npm run dist:win`)
y Dani lo arranca a mano.

## Alternativas descartadas

- Quitar los fusibles para probar: se probaría un ejecutable distinto del que se entrega.

## Consecuencias

Lo que solo afecta al zip (fusibles, `asarUnpack`, el fusible de integridad del asar) necesita una
prueba a mano en un perfil o una máquina virtual de prueba, nunca en el perfil de Dani.
