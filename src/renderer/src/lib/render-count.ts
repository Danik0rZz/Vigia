import { useEffect, useRef, type RefObject } from 'react'

/**
 * Contador de renders para los e2e (ficha 0059): demuestra que el React Compiler evita repintar
 * las filas que no cambian. Solo se activa en modo e2e (sin empaquetar y con VIGIA_E2E=1, lo
 * decide main); en la app empaquetada nunca, así que el atributo no aparece y el coste es un
 * efecto que sale en la primera línea.
 */
let enabled = false

/** Activa el contador; `main.tsx` lo llama antes del primer render si main está en modo e2e. */
export function enableRenderCount(): void {
  enabled = true
}

/**
 * Ref para el elemento raíz de un componente: con el contador activo, tras cada render que
 * llega al DOM le pone `data-render-count` con las veces que se ha pintado desde que se montó.
 * Se escribe en un efecto (no durante el render) para cumplir las reglas de React y que el
 * compilador pueda memoizar el componente.
 */
export function useRenderCount<E extends HTMLElement>(): RefObject<E | null> {
  const element = useRef<E>(null)
  const count = useRef(0)
  // Sin dependencias: corre tras cada render del componente, que es justo lo que se cuenta.
  useEffect(() => {
    if (!enabled) return
    count.current += 1
    element.current?.setAttribute('data-render-count', String(count.current))
  })
  return element
}
