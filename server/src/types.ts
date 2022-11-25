import type {
  IConfigComponent,
  ILoggerComponent,
  IHttpServerComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'
import { metricDeclarations } from './metrics'
import * as uWS from 'uWebSockets.js'

export type GlobalContext = {
  app: uWS.TemplatedApp
  components: BaseComponents
}

// components used in every environment
export type BaseComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
}

// components used in runtime
export type AppComponents = BaseComponents

// components used in tests
export type TestComponents = BaseComponents

export type IWsTestComponent = {
  createWs(relativeUrl: string): WebSocket
}

// this type simplifies the typings of http handlers
export type HandlerContextWithPath<
  ComponentNames extends keyof AppComponents,
  Path extends string = any
> = IHttpServerComponent.PathAwareContext<
  IHttpServerComponent.DefaultContext<{
    components: Pick<AppComponents, ComponentNames>
  }>,
  Path
>

export type Context<Path extends string = any> = IHttpServerComponent.PathAwareContext<GlobalContext, Path>

export enum Stage {
  LINEAR,
  READY
}

export type WebSocket = uWS.WebSocket & {
  id: number
}
