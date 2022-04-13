import assert from "assert";
import msgpack from "@msgpack/msgpack";
import uniqueId from "lodash/uniqueId";
import { PlayerLogLevel, RequestAdminInterfaceData, TryCpClient } from "..";
import { TRYCP_SERVER_HOST, TRYCP_SERVER_PORT } from "../trycp-server";
import {
  decodeAppApiPayload,
  decodeAppApiResponse,
  decodeTryCpAdminApiResponse,
} from "../util";
import {
  AgentInfoSigned,
  AgentPubKey,
  CallZomeRequest,
  CellId,
  HoloHash,
  InstalledAppId,
} from "@holochain/client";
import { DnaInstallOptions, ZomeResponsePayload } from "./types";
import { _TryCpResponseAdminApi } from "../types";

const DEFAULT_PARTIAL_PLAYER_CONFIG = `signing_service_uri: ~
encryption_service_uri: ~
decryption_service_uri: ~
dpki: ~
network: ~`;

/**
 * @public
 */
export type PlayerId = string;

/**
 * The function to create a TryCP Conductor (called "Player").
 *
 * @param url - The URL of the TryCP server to connect to.
 * @param id - An optional name for the Player.
 * @returns A configured Conductor instance.
 *
 * @public
 */
export const createConductor = async (url?: string, id?: PlayerId) => {
  url = url || `ws://${TRYCP_SERVER_HOST}:${TRYCP_SERVER_PORT}`;
  const client = await TryCpClient.create(url);
  return new Player(client, id);
};

/**
 * @public
 */
export class Player {
  private id: string;

  public constructor(private readonly tryCpClient: TryCpClient, id?: PlayerId) {
    this.id = "player-" + (id || uniqueId());
  }

  async destroy() {
    await this.shutdown();
    return this.tryCpClient.close();
  }

  async reset() {
    return this.tryCpClient.call({
      type: "reset",
    });
  }

  async downloadDna(url: URL) {
    const response = await this.tryCpClient.call({
      type: "download_dna",
      url: url.href,
    });
    assert(typeof response === "string");
    return response;
  }

  async saveDna(dnaContent: Buffer) {
    const response = await this.tryCpClient.call({
      type: "save_dna",
      id: "./entry.dna",
      content: dnaContent,
    });
    assert(typeof response === "string");
    return response;
  }

  async configure(partialConfig?: string) {
    return this.tryCpClient.call({
      type: "configure_player",
      id: this.id,
      partial_config: partialConfig || DEFAULT_PARTIAL_PLAYER_CONFIG,
    });
  }

  async startup(log_level?: PlayerLogLevel) {
    return this.tryCpClient.call({
      type: "startup",
      id: this.id,
      log_level,
    });
  }

  async shutdown() {
    return this.tryCpClient.call({
      type: "shutdown",
      id: this.id,
    });
  }

  async registerDna(path: string) {
    const type = "register_dna";
    const response = await this.tryCpClient.call({
      type: "call_admin_interface",
      id: this.id,
      message: msgpack.encode({
        type,
        data: { path },
      }),
    });
    const decodedResponse = decodeTryCpAdminApiResponse(response);
    this.checkResponseForError(type, decodedResponse);
    assert("BYTES_PER_ELEMENT" in decodedResponse.data);
    const dnaHash: HoloHash = decodedResponse.data;
    return dnaHash;
  }

  async generateAgentPubKey(): Promise<HoloHash> {
    const type = "generate_agent_pub_key";
    const response = await this.tryCpClient.call({
      type: "call_admin_interface",
      id: this.id,
      message: msgpack.encode({ type: "generate_agent_pub_key" }),
    });
    const decodedResponse = decodeTryCpAdminApiResponse(response);
    this.checkResponseForError(type, decodedResponse);
    assert("BYTES_PER_ELEMENT" in decodedResponse.data);
    const agentPubKey: HoloHash = decodedResponse.data;
    return agentPubKey;
  }

  async installApp(data: {
    installed_app_id: string;
    agent_key: AgentPubKey;
    dnas: DnaInstallOptions[];
  }) {
    const type = "install_app";
    const response = await this.tryCpClient.call({
      type: "call_admin_interface",
      id: this.id,
      message: msgpack.encode({
        type,
        data,
      }),
    });
    const decodedResponse = decodeTryCpAdminApiResponse(response);
    this.checkResponseForError(type, decodedResponse);
    assert("cell_data" in decodedResponse.data);
    return decodedResponse.data;
  }

  async enableApp(installed_app_id: InstalledAppId) {
    const type = "enable_app";
    const response = await this.tryCpClient.call({
      type: "call_admin_interface",
      id: this.id,
      message: msgpack.encode({
        type,
        data: {
          installed_app_id,
        },
      }),
    });
    const decodedResponse = decodeTryCpAdminApiResponse(response);
    this.checkResponseForError(type, decodedResponse);
    assert("app" in decodedResponse.data);
    return decodedResponse.data;
  }

  async attachAppInterface(port: number) {
    const type = "attach_app_interface";
    const adminRequestData: RequestAdminInterfaceData = {
      type,
      data: { port },
    };
    const response = await this.tryCpClient.call({
      type: "call_admin_interface",
      id: this.id,
      message: msgpack.encode(adminRequestData),
    });
    const decodedResponse = decodeTryCpAdminApiResponse(response);
    this.checkResponseForError(type, decodedResponse);
    assert("port" in decodedResponse.data);
    return decodedResponse.data.port;
  }

  async connectAppInterface(port: number) {
    return this.tryCpClient.call({
      type: "connect_app_interface",
      port,
    });
  }

  /**
   * Get agent infos, optionally of a particular cell.
   * @param cellId - The cell id to get agent infos of.
   * @returns The agent infos.
   */
  async requestAgentInfo(cellId?: CellId) {
    const type = "request_agent_info";
    const response = await this.tryCpClient.call({
      type: "call_admin_interface",
      id: this.id,
      message: msgpack.encode({
        type,
        data: {
          cell_id: cellId || null,
        },
      }),
    });
    const decodedResponse = decodeTryCpAdminApiResponse(response);
    this.checkResponseForError(type, decodedResponse);
    assert(Array.isArray(decodedResponse.data));
    const agentInfos: AgentInfoSigned[] = decodedResponse.data;
    return agentInfos;
  }

  /**
   * Add agents to a conductor.
   * @param signedAgentInfos - The agents to add to the conductor.
   */
  async addAgentInfo(signedAgentInfos: AgentInfoSigned[]) {
    const type = "add_agent_info";
    const response = await this.tryCpClient.call({
      type: "call_admin_interface",
      id: this.id,
      message: msgpack.encode({
        type,
        data: { agent_infos: signedAgentInfos },
      }),
    });
    const decodedResponse = decodeTryCpAdminApiResponse(response);
    this.checkResponseForError(type, decodedResponse);
    assert(decodedResponse.type === "agent_info_added");
  }

  /**
   * Make a zome call to the TryCP server.
   */
  async callZome<T extends ZomeResponsePayload>(
    port: number,
    request: CallZomeRequest
  ) {
    request.payload = msgpack.encode(request.payload);
    const response = await this.tryCpClient.call({
      type: "call_app_interface",
      port,
      message: msgpack.encode({
        type: "zome_call",
        data: request,
      }),
    });
    const decodedResponse = decodeAppApiResponse(response);
    this.checkResponseForError(
      `zome ${request.zome_name} fn ${request.fn_name}`,
      decodedResponse
    );
    const decodedPayload = decodeAppApiPayload<T>(decodedResponse.data);
    return decodedPayload;
  }

  checkResponseForError(requestType: string, response: _TryCpResponseAdminApi) {
    if (response.type === "error") {
      const errorMessage = `error when calling ${requestType}:\n${JSON.stringify(
        response.data,
        null,
        4
      )}`;
      throw new Error(errorMessage);
    }
  }
}