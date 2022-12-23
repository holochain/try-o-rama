import {
  AddAgentInfoRequest,
  AgentInfoRequest,
  AgentPubKey,
  AppBundleSource,
  AppInfoRequest,
  AppSignalCb,
  AttachAppInterfaceRequest,
  CallZomeRequest,
  CallZomeRequestSigned,
  CapSecret,
  CellId,
  CreateCloneCellRequest,
  DeleteCloneCellRequest,
  DisableAppRequest,
  DisableCloneCellRequest,
  DnaDefinition,
  DnaHash,
  DnaSource,
  DumpFullStateRequest,
  DumpStateRequest,
  EnableAppRequest,
  EnableCloneCellRequest,
  encodeHashToBase64,
  FullStateDump,
  FunctionName,
  generateSigningKeyPair,
  GetDnaDefinitionRequest,
  getSigningCredentials,
  GrantZomeCallCapabilityRequest,
  InstallAppRequest,
  ListAppsRequest,
  randomCapSecret,
  RegisterDnaRequest,
  setSigningCredentials,
  signZomeCall,
  StartAppRequest,
  UninstallAppRequest,
  ZomeName,
} from "@holochain/client";
import getPort, { portNumbers } from "get-port";
import assert from "node:assert";
import { URL } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { enableAndGetAgentApp } from "../../common.js";
import { makeLogger } from "../../logger.js";
import {
  AgentApp,
  AgentsAppsOptions,
  AppOptions,
  IConductor,
} from "../../types.js";
import { TryCpClient, TryCpConductorLogLevel } from "../index.js";
import {
  RequestAdminInterfaceMessage,
  RequestCallAppInterfaceMessage,
  TRYCP_SUCCESS_RESPONSE,
} from "../types.js";
import { deserializeZomeResponsePayload } from "../util.js";

const logger = makeLogger("TryCP conductor");

/**
 * The default partial config for a TryCP conductor.
 *
 * @public
 */
export const DEFAULT_PARTIAL_PLAYER_CONFIG = `signing_service_uri: ~
encryption_service_uri: ~
decryption_service_uri: ~
dpki: ~
network: ~`;

/**
 * @public
 */
export type ConductorId = string;

/**
 * @public
 */
export interface TryCpConductorOptions {
  /**
   * Identifier for the conductor (optional).
   */
  id?: ConductorId;

  /**
   * Configuration for the conductor (optional).
   */
  partialConfig?: string;

  /**
   * Start up conductor after creation.
   *
   * default: true
   */
  startup?: boolean;

  /**
   * Log level of the conductor (optional).
   *
   * default: "info"
   */
  logLevel?: TryCpConductorLogLevel;
}

/**
 * The function to create a TryCP Conductor. By default configures and starts
 * it.
 *
 * @param tryCpClient - The client connection to the TryCP server on which to
 * create the conductor.
 * @returns A conductor instance.
 *
 * @public
 */
export const createTryCpConductor = async (
  tryCpClient: TryCpClient,
  options?: TryCpConductorOptions
) => {
  const conductor = new TryCpConductor(tryCpClient, options?.id);
  if (options?.startup !== false) {
    // configure and startup conductor by default
    await conductor.configure(options?.partialConfig);
    await conductor.startUp({ logLevel: options?.logLevel });
  }
  return conductor;
};

/**
 * A class to manage a conductor running on a TryCP server.
 *
 * @public
 */
export class TryCpConductor implements IConductor {
  readonly id: string;
  private appInterfacePort: undefined | number;
  readonly tryCpClient: TryCpClient;

  constructor(tryCpClient: TryCpClient, id?: ConductorId) {
    this.tryCpClient = tryCpClient;
    this.id = id || `conductor-${uuidv4()}`;
  }

  /**
   * Create conductor configuration.
   *
   * @param partialConfig - The configuration to add to the default configuration.
   * @returns An empty success response.
   */
  async configure(partialConfig?: string) {
    const response = await this.tryCpClient.call({
      type: "configure_player",
      id: this.id,
      partial_config: partialConfig || DEFAULT_PARTIAL_PLAYER_CONFIG,
    });
    assert(response === TRYCP_SUCCESS_RESPONSE);
    return response;
  }

  /**
   * Start a configured conductor.
   *
   * @param options - Log level of the conductor. Defaults to "info".
   * @returns An empty success response.
   *
   * @public
   */
  async startUp(options?: { logLevel?: TryCpConductorLogLevel }) {
    const response = await this.tryCpClient.call({
      type: "startup",
      id: this.id,
      log_level: options?.logLevel,
    });
    assert(response === TRYCP_SUCCESS_RESPONSE);
    return response;
  }

  /**
   * Disconnect app interface and shut down the conductor.
   *
   * @returns An empty success response.
   *
   * @public
   */
  async shutDown() {
    if (this.appInterfacePort) {
      const response = await this.disconnectAppInterface();
      assert(response === TRYCP_SUCCESS_RESPONSE);
    }
    const response = await this.tryCpClient.call({
      type: "shutdown",
      id: this.id,
    });
    assert(response === TRYCP_SUCCESS_RESPONSE);
    return response;
  }

  /**
   * Disconnect the TryCP client from the TryCP server.
   *
   * @returns The web socket close code.
   */
  async disconnectClient() {
    const response = await this.tryCpClient.close();
    assert(response === 1000);
    return response;
  }

  /**
   * Download a DNA from a URL to the server's file system.
   *
   * @returns The relative path to the downloaded DNA file.
   */
  async downloadDna(url: URL) {
    const response = await this.tryCpClient.call({
      type: "download_dna",
      url: url.href,
    });
    assert(typeof response === "string");
    return response;
  }

  /**
   * Upload a DNA file from the local file system to the server.
   *
   * @param dnaContent - The DNA as binary content.
   * @returns The relative path to the saved DNA file.
   */
  async saveDna(dnaContent: Buffer) {
    const response = await this.tryCpClient.call({
      type: "save_dna",
      id: "./entry.dna",
      content: dnaContent,
    });
    assert(typeof response === "string");
    return response;
  }

  /**
   * Connect a web socket to the App API.
   *
   * @returns An empty success response.
   */
  async connectAppInterface(signalHandler?: AppSignalCb) {
    assert(this.appInterfacePort, "no app interface attached to conductor");
    const response = await this.tryCpClient.call({
      type: "connect_app_interface",
      port: this.appInterfacePort,
    });
    assert(response === TRYCP_SUCCESS_RESPONSE);
    this.tryCpClient.setSignalHandler(this.appInterfacePort, signalHandler);
    return response;
  }

  /**
   * Disconnect the web socket from the App API.
   *
   * @returns An empty success response.
   */
  async disconnectAppInterface() {
    assert(this.appInterfacePort, "no app interface attached");
    const response = await this.tryCpClient.call({
      type: "disconnect_app_interface",
      port: this.appInterfacePort,
    });
    assert(response === TRYCP_SUCCESS_RESPONSE);
    return response;
  }

  /**
   * Attach a signal handler.
   *
   * @param signalHandler - The signal handler to register.
   */
  on(signalHandler: AppSignalCb) {
    assert(this.appInterfacePort, "no app interface attached to conductor");
    this.tryCpClient.setSignalHandler(this.appInterfacePort, signalHandler);
  }

  /**
   * Detach the registered signal handler.
   */
  off() {
    assert(this.appInterfacePort, "no app interface attached to conductor");
    this.tryCpClient.setSignalHandler(this.appInterfacePort, undefined);
  }

  /**
   * Send a call to the Admin API.
   *
   * @param message - The call to send to the Admin API.
   * @returns The response of the call.
   *
   * @internal
   */
  private async callAdminApi(message: RequestAdminInterfaceMessage) {
    const response = await this.tryCpClient.call({
      type: "call_admin_interface",
      id: this.id,
      message,
    });
    assert(response !== TRYCP_SUCCESS_RESPONSE);
    assert(typeof response !== "string");
    return response;
  }

  /**
   * Get all
   * {@link https://github.com/holochain/holochain-client-js/blob/develop/docs/API_adminwebsocket.md | Admin API methods}
   * of the Holochain client.
   *
   * @returns The Admin API web socket.
   */
  adminWs() {
    /**
     * Upload and register a DNA file.
     *
     * @param request - {@link RegisterDnaRequest} & {@link DnaSource}
     * @returns The registered DNA's {@link HoloHash}.
     */
    const registerDna = async (
      request: RegisterDnaRequest & DnaSource
    ): Promise<DnaHash> => {
      const response = await this.callAdminApi({
        type: "register_dna",
        data: request,
      });
      assert(response.type === "dna_registered");
      return response.data;
    };

    /**
     * Get a DNA definition.
     *
     * @param dnaHash - Hash of DNA to query.
     * @returns The {@link DnaDefinition}.
     */
    const getDnaDefinition = async (
      dnaHash: GetDnaDefinitionRequest
    ): Promise<DnaDefinition> => {
      const response = await this.callAdminApi({
        type: "get_dna_definition",
        data: dnaHash,
      });
      assert(response.type === "dna_definition_returned");
      return response.data;
    };

    /**
     * Grant a capability for a zome call.
     *
     * @param request - Public key to grant and cell, zome and functions for
     * which to grant the capability.
     */
    const grantZomeCallCapability = async (
      request: GrantZomeCallCapabilityRequest
    ) => {
      const response = await this.callAdminApi({
        type: "grant_zome_call_capability",
        data: request,
      });
      assert(response.type === "zome_call_capability_granted");
    };

    /**
     * Generate a new agent pub key.
     *
     * @returns The generated {@link AgentPubKey}.
     */
    const generateAgentPubKey = async (): Promise<AgentPubKey> => {
      const response = await this.callAdminApi({
        type: "generate_agent_pub_key",
      });
      assert(response.type === "agent_pub_key_generated");
      return response.data;
    };

    /**
     * Install an app.
     *
     * @param data - {@link InstallAppBundleRequest}.
     * @returns {@link @holochain/client#InstalledAppInfo}.
     */
    const installApp = async (data: InstallAppRequest) => {
      const response = await this.callAdminApi({
        type: "install_app",
        data,
      });
      assert(response.type === "app_installed");
      return response.data;
    };

    /**
     * Enable an installed hApp.
     *
     * @param request -{@link EnableAppRequest}.
     * @returns {@link @holochain/client#EnableAppResonse}.
     */
    const enableApp = async (request: EnableAppRequest) => {
      const response = await this.callAdminApi({
        type: "enable_app",
        data: request,
      });
      assert(response.type === "app_enabled");
      return response.data;
    };

    /**
     * Disable an installed hApp.
     *
     * @param request -{@link DisableAppRequest}.
     * @returns An empty success response.
     */
    const disableApp = async (request: DisableAppRequest) => {
      const response = await this.callAdminApi({
        type: "disable_app",
        data: request,
      });
      assert(response.type === "app_disabled");
      return response.data;
    };

    /**
     * Start an installed hApp.
     *
     * @param request -{@link StartAppRequest}.
     * @returns {@link @holochain/client#StartAppResponse}.
     */
    const startApp = async (request: StartAppRequest) => {
      const response = await this.callAdminApi({
        type: "start_app",
        data: request,
      });
      assert(response.type === "app_started");
      return response.data;
    };

    /**
     * Uninstall an installed hApp.
     *
     * @param request - {@link UninstallAppRequest}.
     * @returns An empty success response.
     */
    const uninstallApp = async (request: UninstallAppRequest) => {
      const response = await this.callAdminApi({
        type: "uninstall_app",
        data: request,
      });
      assert(response.type === "app_uninstalled");
      return response.data;
    };

    /**
     * List all installed hApps.
     *
     * @param request - Filter by hApp status (optional).
     * @returns A list of all installed hApps.
     */
    const listApps = async (request: ListAppsRequest) => {
      const response = await this.callAdminApi({
        type: "list_apps",
        data: request,
      });
      assert(response.type === "apps_listed");
      return response.data;
    };

    /**
     * List all installed Cell ids.
     *
     * @returns A list of all installed {@link Cell} ids.
     */
    const listCellIds = async () => {
      const response = await this.callAdminApi({ type: "list_cell_ids" });
      assert(response.type === "cell_ids_listed");
      return response.data;
    };

    /**
     * List all installed DNAs.
     *
     * @returns A list of all installed DNAs' role ids.
     */
    const listDnas = async () => {
      const response = await this.callAdminApi({ type: "list_dnas" });
      assert(response.type === "dnas_listed");
      return response.data;
    };

    /**
     * Attach an App interface to the conductor.
     *
     * @param request - The port to attach to.
     * @returns The port the App interface was attached to.
     */
    const attachAppInterface = async (request?: AttachAppInterfaceRequest) => {
      request = request ?? {
        port: await getPort({ port: portNumbers(30000, 40000) }),
      };
      const response = await this.callAdminApi({
        type: "attach_app_interface",
        data: request,
      });
      assert(response.type === "app_interface_attached");
      this.appInterfacePort = request.port;
      return { port: response.data.port };
    };

    /**
     * List all App interfaces.
     *
     * @returns A list of all attached App interfaces.
     */
    const listAppInterfaces = async () => {
      const response = await this.callAdminApi({ type: "list_app_interfaces" });
      assert(response.type === "app_interfaces_listed");
      return response.data;
    };

    /**
     * Get agent infos, optionally of a particular cell.
     *
     * @param req - The cell id to get agent infos of (optional).
     * @returns The agent infos.
     */
    const agentInfo = async (req: AgentInfoRequest) => {
      const response = await this.callAdminApi({
        type: "agent_info",
        data: {
          cell_id: req.cell_id || null,
        },
      });
      assert(response.type === "agent_info");
      return response.data;
    };

    /**
     * Add agents to a conductor.
     *
     * @param request - The agents to add to the conductor.
     */
    const addAgentInfo = async (request: AddAgentInfoRequest) => {
      const response = await this.callAdminApi({
        type: "add_agent_info",
        data: request,
      });
      assert(response.type === "agent_info_added");
    };

    /**
     * Delete a disabled clone cell.
     *
     * @param request - The app id and clone cell id to delete.
     */
    const deleteCloneCell = async (request: DeleteCloneCellRequest) => {
      const response = await this.callAdminApi({
        type: "delete_clone_cell",
        data: request,
      });
      assert(response.type === "clone_cell_deleted");
    };

    /**
     * Request a dump of the cell's state.
     *
     * @param request - The cell id for which state should be dumped.
     * @returns The cell's state as JSON.
     */
    const dumpState = async (request: DumpStateRequest) => {
      const response = await this.callAdminApi({
        type: "dump_state",
        data: request,
      });
      assert("data" in response);
      assert(typeof response.data === "string");
      const stateDump = JSON.parse(response.data.replace(/\\n/g, ""));
      return stateDump as [FullStateDump, string];
    };

    /**
     * Request a full state dump of the cell's source chain.
     *
     * @param request - {@link DumpFullStateRequest}
     * @returns {@link @holochain/client#FullStateDump}.
     */
    const dumpFullState = async (request: DumpFullStateRequest) => {
      const response = await this.callAdminApi({
        type: "dump_full_state",
        data: request,
      });
      assert(response.type === "full_state_dumped");
      return response.data;
    };

    /**
     * Grant a capability for signing zome calls.
     *
     * @param cellId - The cell to grant the capability for.
     * @param functions - The zome functions to grant the capability for.
     * @param signingKey - The assignee of the capability.
     * @returns The cap secret of the created capability.
     */
    const grantSigningKey = async (
      cellId: CellId,
      functions: Array<[ZomeName, FunctionName]>,
      signingKey: AgentPubKey
    ): Promise<CapSecret> => {
      const capSecret = randomCapSecret();
      await grantZomeCallCapability({
        cell_id: cellId,
        cap_grant: {
          tag: "zome-call-signing-key",
          functions,
          access: {
            Assigned: {
              secret: capSecret,
              assignees: [signingKey],
            },
          },
        },
      });
      return capSecret;
    };

    /**
     * Generate and authorize a new key pair for signing zome calls.
     *
     * @param cellId - The cell id to create the capability grant for.
     * @param functions - Zomes and functions to authorize the signing key for.
     */
    const authorizeSigningCredentials = async (
      cellId: CellId,
      functions: [ZomeName, FunctionName][]
    ) => {
      const [keyPair, signingKey] = generateSigningKeyPair();
      const capSecret = await grantSigningKey(cellId, functions, signingKey);
      setSigningCredentials(cellId, { capSecret, keyPair, signingKey });
    };

    return {
      addAgentInfo,
      agentInfo,
      attachAppInterface,
      authorizeSigningCredentials,
      deleteCloneCell,
      disableApp,
      dumpFullState,
      dumpState,
      enableApp,
      generateAgentPubKey,
      getDnaDefinition,
      grantSigningKey,
      grantZomeCallCapability,
      installApp,
      listAppInterfaces,
      listApps,
      listCellIds,
      listDnas,
      registerDna,
      startApp,
      uninstallApp,
    };
  }

  /**
   * Call to the conductor's App API.
   */
  private async callAppApi(message: RequestCallAppInterfaceMessage) {
    assert(this.appInterfacePort, "No App interface attached to conductor");
    const response = await this.tryCpClient.call({
      type: "call_app_interface",
      port: this.appInterfacePort,
      message,
    });
    assert(response !== TRYCP_SUCCESS_RESPONSE);
    assert(typeof response !== "string");
    return response;
  }

  /**
   * Get all
   * {@link https://github.com/holochain/holochain-client-js/blob/develop/docs/API_appwebsocket.md | App API methods}
   * of the Holochain client.
   *
   * @returns The App API web socket.
   */
  appWs() {
    /**
     * Request info of an installed hApp.
     *
     * @param request - The hApp id to query.
     * @returns The app info.
     */
    const appInfo = async (request: AppInfoRequest) => {
      const response = await this.callAppApi({
        type: "app_info",
        data: request,
      });
      assert(response.type === "app_info");
      return response.data;
    };

    /**
     * Make a zome call to a cell in the conductor.
     *
     * @param request - {@link CallZomeRequest}.
     * @returns The result of the zome call.
     */
    const callZome = async <T>(
      request: CallZomeRequest | CallZomeRequestSigned
    ) => {
      let signedRequest: CallZomeRequestSigned;
      if ("signature" in request) {
        signedRequest = request;
      } else {
        const signingCredentials = getSigningCredentials(request.cell_id);
        if (!signingCredentials) {
          throw new Error(
            `cannot sign zome call: no signing credentials have been authorized for cell ${request.cell_id}`
          );
        }
        const signedZomeCall = await signZomeCall(request);
        signedRequest = signedZomeCall;
      }
      const response = await this.callAppApi({
        type: "call_zome",
        data: signedRequest,
      });
      assert("data" in response);
      assert(response.data);
      assert("BYTES_PER_ELEMENT" in response.data);
      const deserializedPayload = deserializeZomeResponsePayload<T>(
        response.data
      );
      return deserializedPayload;
    };

    /**
     * Create a clone cell of an existing DNA.
     *
     * @param request - Clone cell params.
     * @returns The clone id and cell id of the created clone cell.
     */
    const createCloneCell = async (request: CreateCloneCellRequest) => {
      const response = await this.callAppApi({
        type: "create_clone_cell",
        data: request,
      });
      assert(response.type === "clone_cell_created");
      return response.data;
    };

    /**
     * Enable a disabled clone cell.
     *
     * @param request - The clone id or cell id of the clone cell to be
     * enabled.
     * @returns The enabled clone cell's clone id and cell id.
     */
    const enableCloneCell = async (request: EnableCloneCellRequest) => {
      const response = await this.callAppApi({
        type: "enable_clone_cell",
        data: request,
      });
      assert(response.type === "clone_cell_enabled");
      return response.data;
    };

    /**
     * Archive an existing clone cell.
     *
     * @param request - The hApp id to query.
     * @returns An empty success response.
     */
    const disableCloneCell = async (request: DisableCloneCellRequest) => {
      const response = await this.callAppApi({
        type: "disable_clone_cell",
        data: request,
      });
      assert(response.type === "clone_cell_disabled");
      return response.data;
    };

    return {
      appInfo,
      callZome,
      createCloneCell,
      enableCloneCell,
      disableCloneCell,
    };
  }

  /**
   * Install a hApp bundle into the conductor.
   *
   * @param appBundleSource - The bundle or path to the bundle.
   * @param options - {@link AppOptions} for the hApp bundle (optional).
   * @returns A hApp for the agent.
   */
  async installApp(appBundleSource: AppBundleSource, options?: AppOptions) {
    const agent_key =
      options?.agentPubKey ?? (await this.adminWs().generateAgentPubKey());
    const membrane_proofs = options?.membraneProofs ?? {};
    const installed_app_id = options?.installedAppId ?? `app-${uuidv4()}`;
    const network_seed = options?.networkSeed;
    const installAppRequest: InstallAppRequest =
      "bundle" in appBundleSource
        ? {
            bundle: appBundleSource.bundle,
            agent_key,
            membrane_proofs,
            installed_app_id,
            network_seed,
          }
        : {
            path: appBundleSource.path,
            agent_key,
            membrane_proofs,
            installed_app_id,
            network_seed,
          };
    const installedAppInfo = await this.adminWs().installApp(installAppRequest);

    const agentHapp: AgentApp = await enableAndGetAgentApp(
      this,
      agent_key,
      installedAppInfo
    );
    return agentHapp;
  }

  /**
   * Install a hApp bundle into the conductor.
   *
   * @param options - Apps to install for each agent, with agent pub keys etc.
   * (optional).
   * @returns A hApp for the agent.
   */
  async installAgentsApps(options: AgentsAppsOptions) {
    const agentsApps: AgentApp[] = [];
    for (const appForAgent of options.agentsApps) {
      const agent_key =
        appForAgent.agentPubKey ?? (await this.adminWs().generateAgentPubKey());
      const membrane_proofs = appForAgent.membraneProofs ?? {};
      const installed_app_id = options.installedAppId ?? `app-${uuidv4()}`;
      const network_seed = options.networkSeed;
      const installAppRequest: InstallAppRequest =
        "bundle" in appForAgent.app
          ? {
              bundle: appForAgent.app.bundle,
              agent_key,
              membrane_proofs,
              installed_app_id,
              network_seed,
            }
          : {
              path: appForAgent.app.path,
              agent_key,
              membrane_proofs,
              installed_app_id,
              network_seed,
            };

      logger.debug(
        `installing app with id ${installed_app_id} for agent ${encodeHashToBase64(
          agent_key
        )}`
      );
      const installedAppInfo = await this.adminWs().installApp(
        installAppRequest
      );

      const agentApp = await enableAndGetAgentApp(
        this,
        agent_key,
        installedAppInfo
      );
      agentsApps.push(agentApp);
    }
    return agentsApps;
  }
}
