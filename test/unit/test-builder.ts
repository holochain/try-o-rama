const sinon = require('sinon')
const test = require('tape')
const TOML = require('@iarna/toml')

import * as T from '../../src/types'
import Builder from '../../src/config/builder';

export const { instancesDry, instancesSugared } = (() => {
  const dna = Builder.dna('path/to/dna.json', 'dna-id', { uuid: 'uuid' })

  const instancesSugared: T.SugaredInstancesConfig = {
    alice: dna,
    bob: dna,
  }
  const instancesDry: T.DryInstancesConfig = [
    {
      id: 'alice',
      agent: {
        id: 'alice',
        name: 'name::alice::uuid',
        keystore_file: '[UNUSED]',
        public_address: '[SHOULD BE REWRITTEN]',
        test_agent: true,
      },
      dna: {
        id: 'dna-id',
        file: 'path/to/dna.json',
        uuid: 'uuid'
      }
    },
    {
      id: 'bob',
      agent: {
        id: 'bob',
        name: 'name::bob::uuid',
        keystore_file: '[UNUSED]',
        public_address: '[SHOULD BE REWRITTEN]',
        test_agent: true,
      },
      dna: {
        id: 'dna-id',
        file: 'path/to/dna.json',
        uuid: 'uuid'
      }
    }
  ]
  return { instancesDry, instancesSugared }
})()

const commonConfig = { logger: Builder.logger(false), network: Builder.network('n3h') }

test('genBridgeConfig', async t => {
  const bridge = await Builder.bridge('b', 'alice', 'bob')
  t.deepEqual(bridge, { handle: 'b', caller_id: 'alice', callee_id: 'bob' })
  t.end()
})

test('genSignalConfig', async t => {
  const signals = await Builder.signals({})
  t.ok('trace' in signals)
  t.ok('consistency' in signals)
  t.equal(signals.consistency, true)
  t.end()
})

test('genNetworkConfig', async t => {
  const c1 = await Builder.network('memory')({ configDir: '' })
  const c2 = await Builder.network('websocket')({ configDir: '' })
  t.equal(c1.type, 'memory')
  t.equal(c1.transport_configs[0].type, 'memory')
  t.equal(c2.type, 'websocket')
  t.equal(c2.transport_configs[0].type, 'websocket')
  t.end()
})

test('genLoggerConfig', async t => {
  const loggerQuiet = await Builder.logger(false)

  const expectedQuiet = TOML.parse(`
[logger]
type = "debug"
state_dump = false
[[logger.rules.rules]]
exclude = true
pattern = ".*"
  `)

  t.deepEqual(loggerQuiet, expectedQuiet)
  t.end()
})
