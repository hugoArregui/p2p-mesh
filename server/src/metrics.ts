import { IMetricsComponent } from '@well-known-components/interfaces'
import { validateMetricsDeclaration } from '@well-known-components/metrics'

export const metricDeclarations = {
  server_connections: {
    help: 'Number of peer connections',
    type: IMetricsComponent.GaugeType
  },
  server_in_messages: {
    help: 'Number of incoming messages',
    type: IMetricsComponent.CounterType
  },
  server_in_bytes: {
    help: 'Number of bytes from incoming messages',
    type: IMetricsComponent.CounterType
  },
  server_out_messages: {
    help: 'Number of outgoing messages',
    type: IMetricsComponent.CounterType
  },
  server_out_bytes: {
    help: 'Number of bytes from outgoing messages',
    type: IMetricsComponent.CounterType
  },
  server_ws_buffered_amount: {
    help: 'Buffered ammount for a ws',
    type: IMetricsComponent.GaugeType,
    labelNames: ['alias']
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
