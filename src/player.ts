import * as _ from 'lodash'

import { Conductor } from './conductor'
import { Instance } from './instance'
import { SpawnConductorFn, ObjectS, RawConductorConfig, HappBundle, Initialization, AgentId } from './types';
import { makeLogger } from './logger';
import { unparkPort } from './config/get-port-cautiously'
import { CellId, CallZomeRequest, CellNick, AdminWebsocket, AgentPubKey } from '@holochain/conductor-api';
import { unimplemented } from './util';
import { fakeCapSecret } from './common';
import env from './env';
const fs = require('fs').promises

type ConstructorArgs = {
  name: string,
  config: RawConductorConfig,
  configDir: string,
  adminInterfacePort: number,
  onSignal: ({ instanceId: string, signal: Signal }) => void,
  onJoin: () => void,
  onLeave: () => void,
  onActivity: () => void,
  spawnConductor: SpawnConductorFn,
}

type CallArgs = [CallZomeRequest] | [string, string, string, string, any]

/**
 * Representation of a Conductor user.
 * A Player is essentially a wrapper around a conductor config that was generated,
 * and the possible reference to a conductor which is running based on that config.
 * The Player can spawn or kill a conductor based on the generated config.
 * Players are the main interface for writing scenarios.
 */
export class Player {

  name: string
  logger: any
  config: RawConductorConfig
  onJoin: () => void
  onLeave: () => void
  onSignal: ({ instanceId: string, signal: Signal }) => void
  onActivity: () => void

  _conductor: Conductor | null
  _configDir: string
  _adminInterfacePort: number
  _spawnConductor: SpawnConductorFn
  _agentIdToKey: ObjectS<AgentPubKey>

  constructor({ name, config, configDir, adminInterfacePort, onJoin, onLeave, onSignal, onActivity, spawnConductor }: ConstructorArgs) {
    this.name = name
    this.logger = makeLogger(`player ${name}`)
    this.onJoin = onJoin
    this.onLeave = onLeave
    this.onSignal = onSignal
    this.onActivity = onActivity
    this.config = config

    this._conductor = null
    this._configDir = configDir
    this._adminInterfacePort = adminInterfacePort
    this._spawnConductor = spawnConductor
    this._agentIdToKey = {}
  }

  admin = (): AdminWebsocket => {
    if (this._conductor) {
      return this._conductor.adminClient!
    } else {
      throw new Error("Conductor is not spawned: admin interface unavailable")
    }
  }

  call = async (...args: CallArgs) => {
    if (args.length === 5) {
      this._conductorGuard(`Player.call(${JSON.stringify(args)})`)
      const [appId, cellNick, zome_name, fn_name, payload] = args
      return this._conductor!.callZome(
        appId,
        cellNick,
        zome_name,
        fn_name,
        payload,
      )
    } else if (args.length === 1) {
      throw new Error("deprecated")
//      this._conductorGuard(`call(${JSON.stringify(args[0])})`)
//      return this._conductor!.appClient!.callZome(args[0])
    } else {
      throw new Error("Must use either 1 or 5 arguments with `player.call`")
    }
  }

  /**
   * Get a particular cellId given a CellNick from the conductor instance
   */
  cellId = (appId: string, nick: CellNick): CellId => {
    this._conductorGuard(`cellId(${appId}, ${nick})`)
    return this._conductor!.cellId(appId, nick)
  }

  stateDump = async (appId: string, nick: CellNick): Promise<any> => {
    return this.admin()!.dumpState({
      cell_id: this.cellId(appId, nick)
    })
  }

  /**
   * Get a particular Instance of this conductor.
   * The reason for supplying a getter rather than allowing direct access to the collection
   * of instances is to allow middlewares to modify the instanceId being retrieved,
   * especially for singleConductor middleware
   */
  instance = (instanceId) => {
    this._conductorGuard(`instance(${instanceId})`)
    unimplemented("Player.instance")
    // return _.cloneDeep(this._instances[instanceId])
  }

  instances = (filterPredicate?): Array<Instance> => {
    unimplemented("Player.instances")
    return []
    // return _.flow(_.values, _.filter(filterPredicate), _.cloneDeep)(this._instances)
  }

  /**
   * Spawn can take a function as an argument, which allows the caller
   * to do something with the child process handle, even before the conductor
   * has fully started up. Otherwise, by default, you will have to wait for
   * the proper output to be seen before this promise resolves.
   */
  spawn = async (spawnArgs: any) => {
    if (this._conductor) {
      this.logger.warn(`Attempted to spawn conductor '${this.name}' twice!`)
      return
    }

    await this.onJoin()
    this.logger.debug("spawning")
    const conductor = await this._spawnConductor(this, spawnArgs)

    this.logger.debug("spawned")
    this._conductor = conductor

    this.logger.debug("initializing")
    await this._conductor.initialize()

    this.logger.debug("initialized")
  }

  kill = async (signal = 'SIGINT'): Promise<boolean> => {
    if (this._conductor) {
      const c = this._conductor
      this._conductor = null
      this.logger.debug("Killing...")
      await c.kill(signal)
      this.logger.debug("Killed.")
      await this.onLeave()
      return true
    } else {
      this.logger.warn(`Attempted to kill conductor '${this.name}' twice`)
      return false
    }
  }

  /** Runs at the end of a test run */
  cleanup = async (signal = 'SIGINT'): Promise<boolean> => {
    this.logger.debug("calling Player.cleanup, conductor: %b", this._conductor)
    if (this._conductor) {
      await this.kill(signal)
      unparkPort(this._adminInterfacePort)
      return true
    } else {
      unparkPort(this._adminInterfacePort)
      return false
    }
  }

  /**
   * helper to create agent pub keys and install multiple apps for scenario initialization
   */
  initializeApps = async (init: Initialization) => {
    this._conductorGuard(`Player.initializeApps`)
    const admin: AdminWebsocket = this._conductor!.adminClient!

    // collect all the agent-ids from the initialization removing duplicates
    const agents = [...new Set(init.map(app => app.agentId))]

    for (const agent_id of agents) {
      if (this._agentIdToKey[agent_id]) {
        throw new Error(`Player.initializeApps: agent key already exists for ${agent_id}!`)
      }
    }

    // create keys for all the agent_ids and store them for later reference
    const agentIdToKey = _.fromPairs(await Promise.all(
      agents.map(async name => [name, await admin.generateAgentPubKey()])
    ))
    for (const id in agentIdToKey) {
      this._agentIdToKey[id] = agentIdToKey[id]
    }

    // install each app in the initialization with it's agent
    for (const app of init) {
      const agent_key = this._agentIdToKey[app.agentId]
      this._conductor!.installApp(agent_key, app)
    }
  }

  /**
   * retrieve the pub key of an agent by id
   */
  getAgentKey = (agent_id: AgentId): AgentPubKey | undefined => {
    return this._agentIdToKey[agent_id]
  }

  /**
   * expose installApp at the player level for in-scenario dynamic installation of apps
   */
  installApp = async (agent_key: AgentPubKey, app: HappBundle) => {
    this._conductorGuard(`Player.installApp(${agent_key})`)
    this._conductor!.installApp(agent_key, app)
  }

  _conductorGuard = (context) => {
    if (this._conductor === null) {
      const msg = `Attempted conductor action when no conductor is running! You must \`.spawn()\` first.\nAction: ${context}`
      this.logger.error(msg)
      throw new Error(msg)
    } else {
      this.logger.debug(context)
    }
  }
}
