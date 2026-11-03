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

export {
  chatRouter,
  apiDefinitionRouter,
  modelsRouter,
  completionsRouter,
  messagesRouter,
  responsesRouter,
}

export default [
  chatRouter,
  apiDefinitionRouter,
  modelsRouter,
  completionsRouter,
  messagesRouter,
  responsesRouter,
]
