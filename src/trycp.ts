import * as _ from 'lodash'
// import connect from '@holochain/conductor-api'
import logger from './logger'
import * as T from './types'
import {Client as RpcWebSocket} from 'rpc-websockets'
import * as yaml from 'yaml';

export interface PartialConductorConfig {
  signing_service_uri?: string,
  encryption_service_uri?: string,
  decryption_service_uri?: string,
  network?: T.KitsuneP2pConfig,
  // dpki?: ??
}

export type TrycpClient = {
  dna: (url: string) => Promise<{path: string}>,
  configure_player: (id, partial_config: PartialConductorConfig) => Promise<any>,
  spawn: (id) => Promise<any>,
  kill: (id, signal?) => Promise<any>,
  ping: (id) => Promise<string>,
  reset: () => Promise<void>,
  closeSession: () => Promise<void>,
}

export const trycpSession = async (url: string): Promise<TrycpClient> => {
  const ws = new RpcWebSocket(url)
  await new Promise((resolve) => ws.once("open", resolve))

  const makeCall = (method) => async (a) => {
    logger.debug(`trycp client request to ${url}: ${method} => ${JSON.stringify(a, null, 2)}`)
    const result = await ws.call(method)(a)
    logger.debug('trycp client response: %j', result)
    return result
  }

  return {
    dna: (url) => makeCall('dna')({ url }),
    configure_player: (id, partial_config) => makeCall('configure_player')({ id, partial_config: yaml.stringify(partial_config)}),
    spawn: (id) => makeCall('startup')({ id }),
    kill: (id, signal?) => makeCall('shutdown')({ id, signal }),
    ping: () => makeCall('ping')(undefined),
    reset: () => makeCall('reset')({}),
    closeSession: () => ws.close(),
  }
}
