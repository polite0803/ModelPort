/**
 * Management API Routes Index
 * Exports all management route modules
 */

import configRouter from './config'
import providersRouter from './providers'
import accountsRouter from './accounts'
import apiKeysRouter from './apiKeys'
import modelMappingsRouter from './modelMappings'
import sessionsRouter from './sessions'
import statisticsRouter from './statistics'
import proxyRouter from './proxy'
import compressionRouter from './compression'
import tlsRouter from './tls'
import identityRouter from './identity'
import rpcRouter from './rpc'
import eventsRouter from './events'
import backupRouter from './backup'

export {
  configRouter,
  providersRouter,
  accountsRouter,
  apiKeysRouter,
  modelMappingsRouter,
  sessionsRouter,
  statisticsRouter,
  proxyRouter,
  compressionRouter,
  tlsRouter,
  identityRouter,
  rpcRouter,
  eventsRouter,
  backupRouter,
}

export default [
  configRouter,
  providersRouter,
  accountsRouter,
  apiKeysRouter,
  modelMappingsRouter,
  sessionsRouter,
  statisticsRouter,
  proxyRouter,
  compressionRouter,
  tlsRouter,
  identityRouter,
  rpcRouter,
  eventsRouter,
  backupRouter,
]
