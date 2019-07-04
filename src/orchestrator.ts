const tape = require('tape')
const colors = require('colors/safe')
const getPort = require('get-port')

import * as _ from 'lodash'

import {connect} from '@holochain/hc-web-client'
import {Waiter, FullSyncNetwork, NodeId, NetworkMap, Signal} from '@holochain/hachiko'

import * as T from './types'
import {ObjectS} from './types'
import {Conductor} from './conductor'
import {ScenarioApi} from './api'
import {ConductorMap, InstanceMap} from './instance'
import {simpleExecutor} from './executors'
import {identity} from './util'
import logger from './logger'
import {Callbacks} from './callbacks'

const MAX_RUNS_PER_CONDUCTOR = 1
const MIN_POOL_SIZE = 1

/////////////////////////////////////////////////////////////

type OrchestratorConstructorParams = {
  conductors: ObjectS<T.ConductorConfigShorthand>,
  middleware?: any,
  executor?: any,
  debugLog?: boolean,

  // this is used to spawn conductors, and is incompatible with the following two options
  spawnConductor: T.SpawnConductorFn,

  // these two are used to register external conductors over HTTP
  callbacksAddress?: string,
  callbacksPort?: number,
}

export const OrchestratorClass = Conductor => class Orchestrator {
  conductorConfigs: ObjectS<T.ConductorConfig>
  conductorPool: Array<{conductor: Conductor, runs: number}>
  scenarios: Array<any>
  middleware: any | void
  executor: any | void
  conductorOpts: any | void
  waiter: Waiter
  startNonce: number
  callbacks: Callbacks | void
  conductors: Array<Conductor>
  haveAllConductors: Promise<void>
  _spawnConductor: T.SpawnConductorFn
  _resolveHaveAllConductors: any

  constructor ({
    conductors,
    spawnConductor,
    middleware = identity,
    executor = simpleExecutor,
    debugLog = false,
    callbacksAddress = '0.0.0.0',
    callbacksPort = 9999,
  }: OrchestratorConstructorParams) {

    this.conductors = []
    this.conductorConfigs = {}
    this.middleware = middleware
    this.executor = executor
    this.conductorOpts = {debugLog}
    this._spawnConductor = spawnConductor

    this.scenarios = []
    this.conductorPool = []
    this.startNonce = 1

    this.conductorConfigs = desugarConductorConfig(conductors)

    this.registerScenario.only = this.registerScenarioOnly.bind(this)

    this.refreshWaiter()

    this.haveAllConductors = new Promise(resolve => {
      this._resolveHaveAllConductors = resolve
    })

    //this.callbacks = new Callbacks(callbacksAddress, callbacksPort, this.registerConductor.bind(this))
  }

  onSignal ({conductorName, instanceId, signal}) {
    const instanceConfig = this.conductorConfigs[conductorName].instances.find(c => c.id === instanceId)
    if (!instanceConfig) {
      throw new Error(`Got a signal from a not-configured instance! conductor: ${conductorName}, instance: ${instanceId}`)
    }
    const dnaId = instanceConfig.dna.id
    const nodeId = makeAgentId(conductorName, instanceId)
    signal = stringifySignal(signal)
    this.waiter.handleObservation({node: nodeId, signal, dna: dnaId})
  }

  async registerConductor (externalConductor: T.ExternalConductor) {
    logger.info("Conductor connected: %s", externalConductor.name)
    const conductor = await this._newExternalConductor(externalConductor)
    this.conductors.push(conductor)
    const hasAll = this.conductors.length >= Object.keys(this.conductorConfigs).length
    if (hasAll) {
      this._resolveHaveAllConductors()
    }
  }

  async _newExternalConductor ({name, url}: T.ExternalConductor): Promise<Conductor> {
    this.startNonce += MAX_RUNS_PER_CONDUCTOR * 2 // just to be safe
    const conductor = new Conductor(connect, {
      name,
      adminInterfaceUrl: url,
      onSignal: this.onSignal.bind(this),
      ...this.conductorOpts
    })
    await conductor.initialize()
    return conductor
  }

  async _newInternalConductor (name: string): Promise<Conductor> {
    const port = await getPort()
    const url = `http://0.0.0.0:${port}`
    const conductor = new Conductor(connect, {
      name,
      adminInterfaceUrl: url,
      onSignal: this.onSignal.bind(this),
      ...this.conductorOpts
    })
    await conductor.initialize()
    return conductor
  }

  currentConductor () {
    return this.conductorPool[0]
  }

  /**
   * More conveniently create config for a DNA
   */
  static dna = (path, id = `${path}`, opts = {}) => ({ path, id, ...opts })

  /**
   * More conveniently create config for a bridge
   */
  static bridge = (handle, caller_id, callee_id) => ({handle, caller_id, callee_id})

  /**
   * scenario takes (s, instances)
   */
  registerScenario: any = (desc, scenario) => {
    const execute = () => this.executor(
      this.runScenario,
      scenario,
      desc
    )
    this.scenarios.push([desc, execute, false])
  }

  registerScenarioOnly = (desc, scenario) => {
    const execute = () => this.executor(
      this.runScenario,
      scenario,
      desc
    )
    this.scenarios.push([desc, execute, true])
  }

  runScenario = async scenario => {
    await this.refreshWaiter()
    const modifiedScenario = this.middleware(scenario)

    let conductorMap: ConductorMap = {}

    try {
      let i = 0
      for (const [name, config] of Object.entries(this.conductorConfigs)) {
        let conductor = this.conductors[i++]
        logger.debug('preparing run...')
        await conductor.prepareRun(config)
        logger.debug('...run prepared.')
        // set a reference to this conductor on the passed object
        // TODO: use this to allow starting and stopping the conductor itself
        conductorMap[name] = _.merge(conductor.instanceMap, {_conductor: conductor})
      }
    } catch (e) {
      logger.error("Error during test instance setup:")
      logger.error(e)
      throw e
    }

    logger.info("CONDUCTOR MAP: %j", conductorMap)

    try {
      const api = new ScenarioApi(this.waiter, conductorMap)
      // Wait for Agent entries, etc. to be gossiped and held
      await api.consistent()
      logger.debug('running scenario...')
      await modifiedScenario(api, conductorMap)
      logger.debug('...scenario ran')
    } catch (e) {
      this.failTest(e)
    } finally {
      try {
        let i = 0
        for (const [name, config] of Object.entries(this.conductorConfigs)) {
          let conductor = this.conductors[i++]
          logger.debug('cleaning up run...')
          await conductor.cleanupRun(config)
          logger.debug('...cleaned up')
        }
      } catch (e) {
        logger.error("Error during test instance cleanup:")
        logger.error(e)
        throw e
      }
    }
  }

  failTest (e) {
    logger.error("Test failed while running: %j", e)
    throw e
  }

  refreshWaiter = () => new Promise(resolve => {
    if (this.waiter) {
      logger.info("Test over, waiting for Waiter to flush...")
      // Wait for final networking effects to resolve
      this.waiter.registerCallback({nodes: null, resolve})
    } else {
      resolve()
    }
  }).then(() => {
    const networkModels: NetworkMap = _.chain(this.conductorConfigs)
      .toPairs()
      .map(([name, c]) => c.instances.map(i => ({
        id: `${name}::${i.id}`,
        dna: i.dna.id
      })))
      .flatten()
      .groupBy(n => n.dna)
      .mapValues(ns => new FullSyncNetwork(ns.map(n => n.id)))
      .value()
    this.waiter = new Waiter(networkModels)
  })

  run = async () => {
    logger.info("Waiting for all conductors to connect.")
    logger.info("Conductors in config: %j", Object.keys(this.conductorConfigs))
    await this.haveAllConductors
    logger.info("We have all conductors we need. Starting scenarios.")

    const onlyTests = this.scenarios.filter(([desc, execute, only]) => only)

    if (onlyTests.length > 0) {
      logger.warn(`.only was invoked, only running ${onlyTests.length} test(s)!`)
      for (const [desc, execute, _] of onlyTests) {
        await execute()
      }
    } else {
      for (const [desc, execute, _] of this.scenarios) {
        await execute()
      }
    }
    this.close()
  }

  close = () => {
    for (const {conductor} of this.conductorPool) {
      conductor.kill()
    }
    if(this.callbacks) {
      this.callbacks.stop()
    }
  }
}

export const Orchestrator = OrchestratorClass(Conductor)

/**
 * Go from "shorthand" config to "real" config
 */
const desugarConductorConfig = (config: ObjectS<T.ConductorConfigShorthand>): ObjectS<T.ConductorConfig> => {
  const newConfig = {}
  Object.entries(config).forEach(([conductorName, {instances, bridges}]) => {
    const instanceConfigs = Object.entries(instances).map(([instanceId, dnaConfig]) => {
      return makeInstanceConfig(conductorName, instanceId, dnaConfig)
    })
    newConfig[conductorName] = {
      instances: instanceConfigs,
      bridges: bridges,
    }
  })
  return newConfig
}

const makeInstanceConfig = (conductorName, instanceId, dnaConfig): T.InstanceConfig => {
  return {
    id: instanceId,
    agent: {
      id: instanceId,
      name: makeAgentId(conductorName, instanceId),
    },
    dna: dnaConfig
  }
}

const makeAgentId = (conductorName, instanceId) => `${conductorName}::${instanceId}`

const stringifySignal = orig => {
  const signal = Object.assign({}, orig)
  signal.event = JSON.stringify(signal.event)
  signal.pending = signal.pending.map(p => (p.event = JSON.stringify(p.event), p))
  return signal
}
