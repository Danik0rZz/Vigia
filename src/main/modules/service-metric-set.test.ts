import { describe, expect, it } from 'vitest'
import { serviceMetricSet } from './service-metric-set'

/**
 * Ficha 0046: conjunto de métricas de un SERVICE según su `serviceType` y sus
 * propiedades (tabla de la ficha). Función pura: `serviceMetricSet(serviceType, properties)`
 * da `server`, `client`, `unified` o `activity`. Solo tipos estándar de Dynatrace.
 */

describe('CA2 (0046): serviceMetricSet da el conjunto de la tabla para cada serviceType', () => {
  it.each(['WEB_SERVICE', 'CUSTOM_SERVICE', 'BACKGROUND_ACTIVITY', 'SPAN', 'MESSAGING_SERVICE'])(
    '%s → Servidor',
    (type) => {
      expect(serviceMetricSet(type, {})).toBe('server')
    }
  )

  it('DATABASE_SERVICE → Cliente', () => {
    expect(serviceMetricSet('DATABASE_SERVICE', {})).toBe('client')
  })

  it('EXTERNAL → Cliente (decisión del Orquestador: en vivo solo tiene datos de Cliente)', () => {
    expect(serviceMetricSet('EXTERNAL', {})).toBe('client')
    // Las propiedades de los otros casos no lo cambian.
    expect(serviceMetricSet('EXTERNAL', { webServerName: 'servidor-web' })).toBe('client')
  })

  it('UNIFIED → Unificadas', () => {
    expect(serviceMetricSet('UNIFIED', {})).toBe('unified')
  })

  it('QUEUE_LISTENER_SERVICE → Solo actividad', () => {
    expect(serviceMetricSet('QUEUE_LISTENER_SERVICE', {})).toBe('activity')
  })

  it('WEB_REQUEST_SERVICE: con webServerName, Servidor; sin él, Cliente', () => {
    expect(serviceMetricSet('WEB_REQUEST_SERVICE', { webServerName: 'servidor-web' })).toBe(
      'server'
    )
    expect(serviceMetricSet('WEB_REQUEST_SERVICE', {})).toBe('client')
    // En vivo, sin la propiedad la clave no llega; una cadena vacía cuenta como «sin ella».
    expect(serviceMetricSet('WEB_REQUEST_SERVICE', { webServerName: '' })).toBe('client')
  })

  it('RPC_SERVICE: con remoteEndpoint o remoteServiceName, Cliente; sin ninguno, Servidor', () => {
    expect(serviceMetricSet('RPC_SERVICE', { remoteEndpoint: 'extremo-remoto' })).toBe('client')
    expect(serviceMetricSet('RPC_SERVICE', { remoteServiceName: 'servicio-remoto' })).toBe('client')
    expect(
      serviceMetricSet('RPC_SERVICE', {
        remoteEndpoint: 'extremo-remoto',
        remoteServiceName: 'servicio-remoto'
      })
    ).toBe('client')
    expect(serviceMetricSet('RPC_SERVICE', {})).toBe('server')
    expect(serviceMetricSet('RPC_SERVICE', { remoteEndpoint: '', remoteServiceName: '' })).toBe(
      'server'
    )
  })

  it('las propiedades de otros casos no cambian el conjunto', () => {
    // webServerName solo cuenta en WEB_REQUEST_SERVICE y remote* solo en RPC_SERVICE.
    expect(serviceMetricSet('DATABASE_SERVICE', { webServerName: 'servidor-web' })).toBe('client')
    expect(serviceMetricSet('WEB_SERVICE', { remoteEndpoint: 'extremo-remoto' })).toBe('server')
    expect(serviceMetricSet('UNIFIED', { webServerName: 'servidor-web' })).toBe('unified')
    expect(serviceMetricSet('WEB_REQUEST_SERVICE', { remoteEndpoint: 'extremo-remoto' })).toBe(
      'client'
    )
  })

  it.each([
    ['un tipo desconocido', 'TIPO_QUE_NO_ESTA'],
    ['minúsculas (los valores distinguen mayúsculas)', 'unified'],
    ['vacío', ''],
    ['null', null]
  ])('%s → Servidor', (_case, type) => {
    expect(serviceMetricSet(type, {})).toBe('server')
  })
})
