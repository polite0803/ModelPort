import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseEventFrame } from '../../src/shared/sseFrames.ts'

/**
 * The frame rules the remote UI depends on. A heartbeat that surfaces as an event is the
 * worst failure here: it looks like "the gateway told me there is nothing new", which is
 * exactly the ambiguity between "no data" and "no answer" this repository keeps removing.
 */
test('a named frame with JSON data becomes one event', () => {
  assert.deepEqual(parseEventFrame('event: requestLogs:new\ndata: {"id":"r1"}'), {
    channel: 'requestLogs:new',
    payload: { id: 'r1' },
  })
})

test('heartbeat comments and payload-less frames are not events', () => {
  assert.equal(parseEventFrame(': ping'), null, 'a comment line carries no event')
  assert.equal(parseEventFrame('event: config:changed'), null, 'no data is not an empty update')
  assert.equal(parseEventFrame('data: {"a":1}'), null, 'data without a channel cannot be routed')
  assert.equal(parseEventFrame('event: \ndata: {}'), null, 'an empty channel is not routable')
})

test('multi-line data joins before parsing; broken JSON drops the frame', () => {
  assert.deepEqual(parseEventFrame('event: x\ndata: {"a":\ndata: 1}'), { channel: 'x', payload: { a: 1 } })
  assert.equal(parseEventFrame('event: x\ndata: not-json'), null)
})
