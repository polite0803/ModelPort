/**
 * Proxy Service Module - Route Index
 * Export all routes
 */

import chatRouter from './chat'
import apiDefinitionRouter from './apiDefinition'
import modelsRouter from './models'
import completionsRouter from './completions'
import messagesRouter from './messages'
import responsesRouter from './responses'
import ccrRouter from './ccr'

export {
  chatRouter,
  apiDefinitionRouter,
  modelsRouter,
  completionsRouter,
  messagesRouter,
  responsesRouter,
  ccrRouter,
}

export default [
  chatRouter,
  apiDefinitionRouter,
  modelsRouter,
  completionsRouter,
  messagesRouter,
  responsesRouter,
  ccrRouter,
]
