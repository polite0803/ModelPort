/**
 * Proxy Service Module - Route Index
 * Export all routes
 */

import chatRouter from './chat'
import modelsRouter from './models'
import completionsRouter from './completions'
import messagesRouter from './messages'
import responsesRouter from './responses'

export {
  chatRouter,
  modelsRouter,
  completionsRouter,
  messagesRouter,
  responsesRouter,
}

export default [
  chatRouter,
  modelsRouter,
  completionsRouter,
  messagesRouter,
  responsesRouter,
]
