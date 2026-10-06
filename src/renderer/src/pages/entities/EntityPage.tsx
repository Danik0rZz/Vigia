import { createElement, type JSX } from 'react'
import { useParams } from 'react-router'
import { entityPageFor } from './registry'

/** Ruta /entities/:entityType/:entityId: la página del tipo (o la genérica). */
export function EntityPage(): JSX.Element {
  const { entityType = '', entityId = '' } = useParams()
  // createElement y no JSX: la página sale del registro (componentes fijos, de
  // módulo), no se crea en el render. La clave la reinicia (foco y estado) al
  // pasar de una entidad a otra.
  return createElement(entityPageFor(entityType), {
    key: `${entityType}/${entityId}`,
    type: entityType,
    id: entityId
  })
}
