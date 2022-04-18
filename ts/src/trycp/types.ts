import {
  AddAgentInfoRequest,
  AgentInfoSigned,
  AppInfoResponse,
  AttachAppInterfaceResponse,
  CallZomeRequest,
  CellId,
  EnableAppResponse,
  HoloHash,
  InstallAppRequest,
  InstalledAppInfo,
} from "@holochain/client";
import { ConductorId } from "./conductor";

/**
 * @internal
 */
export interface _TryCpCall {
  id: number;
  request: TryCpRequest;
}

/**
 * @public
 */
export type TryCpRequest =
  | RequestDownloadDna
  | RequestSaveDna
  | RequestConfigurePlayer
  | RequestStartup
  | RequestShutdown
  | RequestReset
  | RequestConnectAppInterface
  | RequestDisconnectAppInterface
  | RequestCallAppInterface
  | RequestCallAppInterfaceEncoded
  | RequestCallAdminInterface;

/**
 * Request to download a DNA from a URL.
 *
 * @param url - from where to download the DNA
 *
 * @public
 */
export interface RequestDownloadDna {
  type: "download_dna";
  url: string;
}

/**
 * @public
 */
export interface RequestSaveDna {
  type: "save_dna";
  id: string;
  content: Buffer;
}

/**
 * @public
 */
export interface RequestConfigurePlayer {
  type: "configure_player";
  id: ConductorId;
  partial_config: string;
}

/**
 * @public
 */
export type PlayerLogLevel = "error" | "warn" | "info" | "debug" | "trace";

/**
 * @public
 */
export interface RequestStartup {
  type: "startup";
  id: ConductorId;
  log_level?: PlayerLogLevel;
}

/**
 * @public
 */
export interface RequestShutdown {
  type: "shutdown";
  id: ConductorId;
  signal?: "SIGTERM" | "SIGKILL" | "SIGINT";
}

/**
 * @public
 */
export interface RequestReset {
  type: "reset";
}

/**
 * @public
 */
export interface RequestConnectAppInterface {
  type: "connect_app_interface";
  port: number;
}

/**
 * @public
 */
export interface RequestDisconnectAppInterface {
  type: "disconnect_app_interface";
  port: number;
}

/**
 * @public
 */
export interface RequestCallAppInterface {
  type: "call_app_interface";
  port: number;
  message: RequestCallAppInterfaceMessage;
}

/**
 * @internal
 */
export type RequestCallAppInterfaceMessage = RequestCallZome | RequestAppInfo;

/**
 * @public
 */
export interface RequestCallZome {
  type: "zome_call";
  data: CallZomeRequest;
}

/**
 * @public
 */
export interface RequestAppInfo {
  type: "app_info";
  data: { installed_app_id: string };
}

/**
 * @public
 */
export interface RequestCallAppInterfaceEncoded
  extends Omit<RequestCallAppInterface, "message"> {
  message: Uint8Array;
}

/**
 * @param message - Byte code with format RequestAdminInterfaceData
 * @public
 */
export interface RequestCallAdminInterface {
  type: "call_admin_interface";
  id: ConductorId;
  message: RequestAdminInterfaceData;
}

/**
 * @public
 */
export interface RequestAdminInterfaceData {
  type: string;
  data?:
    | Record<string, string | number | CellId | null>
    | InstallAppRequest
    | AddAgentInfoRequest;
}

/**
 * @internal
 */
export interface _TryCpResponseWrapper {
  type: "response";
  id: number;
  response: _TryCpResponse;
}

/**
 * Responses are composed of an object with either `0` or `1` as a property for success or error.
 *
 * @internal
 */
export type _TryCpResponse = _TryCpResponseSuccess | _TryCpResponseError;

/**
 * @internal
 */
export interface _TryCpResponseSuccess {
  0: _TryCpSuccessResponseSeralized;
}

/**
 * @internal
 */
export interface _TryCpResponseError {
  1: TryCpResponseErrorValue;
}

/**
 * @internal
 */
export type _TryCpSuccessResponseSeralized =
  | typeof TRYCP_SUCCESS_RESPONSE
  | string
  | Uint8Array;

/**
 * Value for successful responses from the TryCP server.
 *
 * @public
 */
export type TryCpSuccessResponse =
  | typeof TRYCP_SUCCESS_RESPONSE
  | string
  | _TryCpApiResponse;

/**
 * @public
 */
export const TRYCP_SUCCESS_RESPONSE = null;

/**
 * @public
 */
export type TryCpResponseErrorValue = string | Error;

/**
 * @internal
 */
export type _TryCpApiResponse =
  | AdminApiResponse
  | AppApiResponse
  | ApiErrorResponse;

/**
 * @public
 */
export interface ApiErrorResponse {
  type: "error";
  data: { type: string; data: string };
}

/**
 * @public
 */
export type AdminApiResponse =
  | AdminApiResponseDnaRegistered
  | AdminApiResponseAgentPubKeyGenerated
  | AdminApiResponseAppInstalled
  | AdminApiResponseAppEnabled
  | AdminApiResponseAppInterfaceAttached
  | AdminApiResponseAgentInfoAdded;

/**
 * @public
 */
export interface AdminApiResponseDnaRegistered {
  type: "dna_registered";
  data: HoloHash;
}

/**
 * @public
 */
export interface AdminApiResponseAgentPubKeyGenerated {
  type: "agent_pub_key_generated";
  data: HoloHash;
}

/**
 * @public
 */
export interface AdminApiResponseAppInstalled {
  type: "app_installed";
  data: InstalledAppInfo;
}

/**
 * @public
 */
export interface AdminApiResponseAppEnabled {
  type: "app_enabled";
  data: EnableAppResponse;
}

/**
 * @public
 */
export interface AdminApiResponseAppInterfaceAttached {
  type: "app_interface_attached";
  data: AttachAppInterfaceResponse;
}

/**
 * @public
 */
export interface AdminApiResponseAgentInfoAdded {
  type: "agent_info_added";
}

/**
 * @public
 */
export interface AdminApiResponseAgentInfoRequested {
  type: "agent_info_requested";
  data: AgentInfoSigned[];
}

/**
 * @public
 */
export type AppApiResponse = AppApiResponseAppInfo | AppApiResponseZomeCall;

/**
 * @public
 */
export interface AppApiResponseAppInfo {
  type: "app_info";
  data: AppInfoResponse | null;
}

/**
 * @public
 */
export interface AppApiResponseZomeCall {
  type: "zome_call";
  data: Uint8Array;
}
