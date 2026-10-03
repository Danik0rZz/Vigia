/**
 * Oculta credenciales en texto que puede acabar en logs o en la interfaz.
 * De los tokens de Dynatrace (`dt0c01.<pública>.<secreta>`) se conserva el id
 * público, que sirve para identificarlos; de las cabeceras, todo el valor.
 */
export function maskSecrets(text: string): string {
  return (
    text
      // Sin límite de palabra: un token pegado a otro texto también se oculta.
      .replace(/(dt0[a-z]\d\d\.[A-Za-z0-9]+)\.[A-Za-z0-9]+/g, '$1.***')
      .replace(/(Bearer|Api-Token)\s+[^\s"']+/gi, '$1 ***')
  )
}
