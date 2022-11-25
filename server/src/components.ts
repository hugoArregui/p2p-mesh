import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { AppComponents } from './types'
import { metricDeclarations } from './metrics'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })

  const logs = await createLogComponent({})
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  return {
    config,
    logs,
    metrics
  }
}
