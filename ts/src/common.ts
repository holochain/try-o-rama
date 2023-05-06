import {
  AgentPubKey,
  AppInfo,
  CallZomeResponse,
  CellType,
  ClonedCell,
  ProvisionedCell,
  RoleName,
} from "@holochain/client";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import assert from "node:assert";
import { makeLogger } from "./logger.js";
import {
  AgentApp,
  CallableCell,
  CellZomeCallRequest,
  IConductor,
} from "./types.js";

const SIGNALING_SERVER_STARTUP_STRING = "HC SIGNAL SRV - ADDR: ";

/**
 * Spawn a signalling server to enable connections between conductors.
 */
export const spawnSignalingServer = async () => {
  const logger = makeLogger("Signalling server");
  const serverProcess = spawn("hc", ["signal-srv"]);
  const startUpComplete = new Promise<[ChildProcessWithoutNullStreams, string]>(
    (resolve) => {
      serverProcess.stdout.on("data", (data: Buffer) => {
        if (data.includes(SIGNALING_SERVER_STARTUP_STRING)) {
          const serverUrl = data
            .toString()
            .split(SIGNALING_SERVER_STARTUP_STRING)[1]
            .split("\n")[0];
          logger.debug(`server url: ${serverUrl}`);
          resolve([serverProcess, serverUrl]);
        } else {
          logger.debug(data.toString());
        }
      });
    }
  );
  return startUpComplete;
};

/**
 * Shutdown signalling server process.
 */
export const shutDownSignalingServer = (
  serverProcess: ChildProcessWithoutNullStreams
) => {
  if (serverProcess.pid === undefined) {
    return null;
  }
  const serverShutdown = new Promise<number | null>((resolve) => {
    serverProcess.on("exit", (code) => {
      serverProcess?.removeAllListeners();
      serverProcess?.stdout.removeAllListeners();
      serverProcess?.stderr.removeAllListeners();
      resolve(code);
    });
    assert(serverProcess.pid);
    process.kill(serverProcess.pid);
  });
  return serverShutdown;
};

/**
 * Add all agents of all conductors to each other. Shortcuts peer discovery
 * through a bootstrap server or gossiping.
 *
 * @param conductors - Conductors to mutually exchange all agents with.
 *
 * @public
 */
export const addAllAgentsToAllConductors = async (conductors: IConductor[]) => {
  await Promise.all(
    conductors.map(async (playerToShareAbout, playerToShareAboutIdx) => {
      const agentInfosToShareAbout = await playerToShareAbout
        .adminWs()
        .agentInfo({
          cell_id: null,
        });
      await Promise.all(
        conductors.map(async (playerToShareWith, playerToShareWithIdx) => {
          if (playerToShareAboutIdx !== playerToShareWithIdx) {
            playerToShareWith.adminWs().addAgentInfo({
              agent_infos: agentInfosToShareAbout,
            });
          }
        })
      );
    })
  );
};

function assertZomeResponse<T>(
  response: CallZomeResponse
): asserts response is T {
  return;
}

export const enableAndGetAgentApp = async (
  conductor: IConductor,
  agentPubKey: AgentPubKey,
  installedAppInfo: AppInfo
) => {
  const enableAppResponse = await conductor.adminWs().enableApp({
    installed_app_id: installedAppInfo.installed_app_id,
  });
  if (enableAppResponse.errors.length) {
    throw new Error(`failed to enable app: ${enableAppResponse.errors}`);
  }
  const cells: CallableCell[] = [];
  const namedCells = new Map<RoleName, CallableCell>();
  Object.keys(installedAppInfo.cell_info).forEach((role_name) => {
    installedAppInfo.cell_info[role_name].forEach((cellInfo) => {
      if (CellType.Provisioned in cellInfo) {
        const callableCell = getCallableCell(
          conductor,
          cellInfo[CellType.Provisioned],
          agentPubKey
        );
        cells.push(callableCell);
        namedCells.set(role_name, callableCell);
      } else if (
        CellType.Cloned in cellInfo &&
        cellInfo[CellType.Cloned].clone_id
      ) {
        const callableCell = getCallableCell(
          conductor,
          cellInfo[CellType.Cloned],
          agentPubKey
        );
        cells.push(callableCell);
        namedCells.set(cellInfo[CellType.Cloned].clone_id, callableCell);
      } else {
        throw new Error("Stem cells are not implemented");
      }
    });
  });
  const agentApp: AgentApp = {
    appId: installedAppInfo.installed_app_id,
    agentPubKey,
    cells,
    namedCells,
  };
  return agentApp;
};

const getCallableCell = (
  conductor: IConductor,
  cell: ClonedCell | ProvisionedCell,
  agentPubKey: AgentPubKey
) => ({
  ...cell,
  callZome: async <T>(request: CellZomeCallRequest, timeout?: number) => {
    const callZomeResponse = await conductor.appWs().callZome(
      {
        ...request,
        cap_secret: null,
        cell_id: cell.cell_id,
        provenance: request.provenance ?? agentPubKey,
        payload: request.payload ?? null,
      },
      timeout
    );
    assertZomeResponse<T>(callZomeResponse);
    return callZomeResponse;
  },
});

/**
 * Get a shorthand function to call a cell's zome.
 *
 * @param cell - The cell to call the zome on.
 * @param zomeName - The name of the Zome to call.
 * @returns A function to call the specified Zome.
 *
 * @public
 */
export const getZomeCaller =
  (cell: CallableCell, zomeName: string) =>
  <T>(fnName: string, payload?: unknown, timeout?: number): Promise<T> =>
    cell.callZome<T>(
      {
        zome_name: zomeName,
        fn_name: fnName,
        payload,
      },
      timeout
    );
