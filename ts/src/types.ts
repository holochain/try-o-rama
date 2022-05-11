import {
  AdminWebsocket,
  AgentPubKey,
  AppBundleSource,
  AppSignalCb,
  AppWebsocket,
  CallZomeRequest,
  CapSecret,
  DnaSource,
  InstalledCell,
  MembraneProof,
  RoleId,
} from "@holochain/client";

/**
 * The zome request options adapted to a specific cell.
 *
 * @public
 */
export type CellZomeCallRequest = Omit<
  CallZomeRequest,
  "cap_secret" | "cell_id" | "payload" | "provenance"
> & {
  cap_secret?: CapSecret;
  provenance?: AgentPubKey;
  payload?: unknown;
};

/**
 * The function for calling a zome from a specific cell.
 *
 * @public
 */
export type CallZomeFn = <T>(request: CellZomeCallRequest) => Promise<T>;

/**
 * Extends an installed cell by a function to call a zome.
 *
 * @public
 */
export interface CallableCell extends InstalledCell {
  callZome: CallZomeFn;
}

/**
 * Provides direct access to cells of a hApp and the agent key.
 *
 * @public
 */
export interface AgentHapp {
  happId: string;
  agentPubKey: Uint8Array;
  cells: CallableCell[];
  namedCells: Map<RoleId, CallableCell>;
}

/**
 * Combines an agent hApp with the conductor they belong to.
 *
 * @public
 */
export interface Player extends AgentHapp {
  conductor: Conductor;
}

/**
 * Optional arguments when installing a hApp bundle.
 *
 * @public
 */
export interface HappBundleOptions {
  agentPubKey?: AgentPubKey;
  installedAppId?: string;
  uid?: string;
  membraneProofs?: Record<string, MembraneProof>;
}

/**
 * Base interface of a Tryorama conductor. Both {@link LocalConductor} and
 * {@link TryCpConductor} implement this interface.
 *
 * @public
 */
export interface Conductor {
  startUp: () => Promise<void | null>;
  shutDown: () => Promise<number | null>;

  connectAppInterface(signalHandler?: AppSignalCb): void;

  adminWs: () => Omit<
    AdminWebsocket,
    | "_requester"
    | "client"
    | "activateApp"
    | "deactivateApp"
    | "defaultTimeout"
    | "listActiveApps"
  >;
  appWs: () => Pick<AppWebsocket, "callZome" | "appInfo">;

  installAgentsHapps: (options: {
    agentsDnas: DnaSource[][];
    uid?: string;
    signalHandler?: AppSignalCb;
  }) => Promise<AgentHapp[]>;
}

/**
 * Base interface of a Tryorama test scenario. Both {@link LocalScenario} and
 * {@link TryCpScenario} implement this interface.
 *
 * @public
 */
export interface Scenario {
  addConductor(signalHandler?: AppSignalCb): Promise<Conductor>;
  addPlayerWithHapp(
    dnas: DnaSource[],
    signalHandler?: AppSignalCb
  ): Promise<Player>;
  addPlayersWithHapps(
    playersDnas: DnaSource[][],
    signalHandlers?: Array<AppSignalCb | undefined>
  ): Promise<Player[]>;
  addPlayerWithHappBundle(
    appBundleSource: AppBundleSource,
    options?: HappBundleOptions & { signalHandler?: AppSignalCb }
  ): Promise<Player>;
  addPlayersWithHappBundles(
    playersHappBundles: Array<{
      appBundleSource: AppBundleSource;
      options?: HappBundleOptions & { signalHandler?: AppSignalCb };
    }>
  ): Promise<Player[]>;
  shutDown(): Promise<void>;
  cleanUp(): Promise<void>;
}
