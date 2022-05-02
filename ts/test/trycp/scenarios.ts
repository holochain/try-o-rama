import test from "tape-promise/tape";
import { Buffer } from "buffer";
import {
  TRYCP_SERVER_PORT,
  TryCpServer,
  TRYCP_SERVER_HOST,
} from "../../src/trycp/trycp-server";
import { TRYCP_SUCCESS_RESPONSE } from "../../src/trycp/types";
import { DnaSource, EntryHash } from "@holochain/client";
import { createTryCpConductor } from "../../src/trycp/conductor";
import { FIXTURE_DNA_URL } from "../fixture";
import { pause } from "../../src/util";

const LOCAL_TEST_PARTIAL_PLAYER_CONFIG = `signing_service_uri: ~
encryption_service_uri: ~
decryption_service_uri: ~
dpki: ~
network:
  transport_pool:
    - type: quic
  network_type: quic_mdns`;

test("TryCP Scenario - Create and read an entry using the entry zome", async (t) => {
  const localTryCpServer = await TryCpServer.start();
  const conductor = await createTryCpConductor(
    `ws://${TRYCP_SERVER_HOST}:${TRYCP_SERVER_PORT}`,
    { partialConfig: LOCAL_TEST_PARTIAL_PLAYER_CONFIG }
  );

  const relativePath = await conductor.downloadDna(FIXTURE_DNA_URL);
  const dnaHash = await conductor.registerDna({ path: relativePath });
  const dnaHashB64 = Buffer.from(dnaHash).toString("base64");
  t.equal(dnaHash.length, 39);
  t.ok(dnaHashB64.startsWith("hC0k"));

  const agentPubKey = await conductor.generateAgentPubKey();
  const agentPubKeyB64 = Buffer.from(agentPubKey).toString("base64");
  t.equal(agentPubKey.length, 39);
  t.ok(agentPubKeyB64.startsWith("hCAk"));

  const appId = "entry-app";
  const installedAppInfo = await conductor.installApp({
    installed_app_id: appId,
    agent_key: agentPubKey,
    dnas: [{ hash: dnaHash, role_id: "entry-dna" }],
  });
  const { cell_id } = installedAppInfo.cell_data[0];
  t.ok(Buffer.from(cell_id[0]).toString("base64").startsWith("hC0k"));
  t.ok(Buffer.from(cell_id[1]).toString("base64").startsWith("hCAk"));

  const enabledAppResponse = await conductor.enableApp({
    installed_app_id: appId,
  });
  t.deepEqual(enabledAppResponse.app.status, { running: null });

  await conductor.attachAppInterface();
  const connectAppInterfaceResponse = await conductor.connectAppInterface();
  t.equal(connectAppInterfaceResponse, TRYCP_SUCCESS_RESPONSE);

  const entryContent = "test-content";
  const createEntryHash = await conductor.callZome<EntryHash>({
    cap_secret: null,
    cell_id,
    zome_name: "crud",
    fn_name: "create",
    provenance: agentPubKey,
    payload: entryContent,
  });
  const createdEntryHashB64 = Buffer.from(createEntryHash).toString("base64");
  t.equal(createEntryHash.length, 39);
  t.ok(createdEntryHashB64.startsWith("hCkk"));

  const readEntryResponse = await conductor.callZome<typeof entryContent>({
    cap_secret: null,
    cell_id,
    zome_name: "crud",
    fn_name: "read",
    provenance: agentPubKey,
    payload: createEntryHash,
  });
  t.equal(readEntryResponse, entryContent);

  await conductor.shutDown();
  await localTryCpServer.stop();
});

test("TryCP Scenario - Reading an entry without having created one will return None", async (t) => {
  const localTryCpServer = await TryCpServer.start();
  const conductor = await createTryCpConductor(
    `ws://${TRYCP_SERVER_HOST}:${TRYCP_SERVER_PORT}`
  );
  const dnas = [{ path: FIXTURE_DNA_URL.pathname }];
  const [alice] = await conductor.installAgentsDnas({
    agentsDnas: [dnas],
  });

  const actual = await conductor.callZome<null>({
    cap_secret: null,
    cell_id: alice.cells[0].cell_id,
    zome_name: "crud",
    fn_name: "read",
    provenance: alice.agentPubKey,
    payload: Buffer.from("hCkk", "base64"),
  });
  t.equal(actual, null);
  await conductor.shutDown();
  await localTryCpServer.stop();
});

test("TryCP Scenario - Create and read an entry using the entry zome, 1 conductor, 2 cells, 2 agents", async (t) => {
  const localTryCpServer = await TryCpServer.start();
  const conductor = await createTryCpConductor(
    `ws://${TRYCP_SERVER_HOST}:${TRYCP_SERVER_PORT}`,
    { partialConfig: LOCAL_TEST_PARTIAL_PLAYER_CONFIG }
  );

  const relativePath = await conductor.downloadDna(FIXTURE_DNA_URL);
  const dnaHash1 = await conductor.registerDna({ path: relativePath });
  const dnaHash2 = await conductor.registerDna({ path: relativePath });
  const dnaHash1B64 = Buffer.from(dnaHash1).toString("base64");
  const dnaHash2B64 = Buffer.from(dnaHash1).toString("base64");
  t.equal(dnaHash1.length, 39);
  t.ok(dnaHash1B64.startsWith("hC0k"));
  t.equal(dnaHash2.length, 39);
  t.ok(dnaHash2B64.startsWith("hC0k"));

  const agent1PubKey = await conductor.generateAgentPubKey();
  const agent1PubKeyB64 = Buffer.from(agent1PubKey).toString("base64");
  t.equal(agent1PubKey.length, 39);
  t.ok(agent1PubKeyB64.startsWith("hCAk"));

  const agent2PubKey = await conductor.generateAgentPubKey();
  const agent2PubKeyB64 = Buffer.from(agent1PubKey).toString("base64");
  t.equal(agent2PubKey.length, 39);
  t.ok(agent2PubKeyB64.startsWith("hCAk"));

  const appId1 = "entry-app1";
  const installedAppInfo1 = await conductor.installApp({
    installed_app_id: appId1,
    agent_key: agent1PubKey,
    dnas: [{ hash: dnaHash1, role_id: "entry-dna" }],
  });
  const cellId1 = installedAppInfo1.cell_data[0].cell_id;
  t.ok(Buffer.from(cellId1[0]).toString("base64").startsWith("hC0k"));
  t.ok(Buffer.from(cellId1[1]).toString("base64").startsWith("hCAk"));

  const appId2 = "entry-app2";
  const installedAppInfo2 = await conductor.installApp({
    installed_app_id: appId2,
    agent_key: agent2PubKey,
    dnas: [{ hash: dnaHash2, role_id: "entry-dna" }],
  });
  const cellId2 = installedAppInfo2.cell_data[0].cell_id;
  t.ok(Buffer.from(cellId2[0]).toString("base64").startsWith("hC0k"));
  t.ok(Buffer.from(cellId2[1]).toString("base64").startsWith("hCAk"));
  t.deepEqual(cellId1[0], cellId2[0]);

  const enabledAppResponse1 = await conductor.enableApp({
    installed_app_id: appId1,
  });
  t.deepEqual(enabledAppResponse1.app.status, { running: null });
  const enabledAppResponse2 = await conductor.enableApp({
    installed_app_id: appId2,
  });
  t.deepEqual(enabledAppResponse2.app.status, { running: null });

  await conductor.attachAppInterface();
  const connectAppInterfaceResponse = await conductor.connectAppInterface();
  t.equal(connectAppInterfaceResponse, TRYCP_SUCCESS_RESPONSE);

  const entryContent = "test-content";
  const createEntryHash = await conductor.callZome<EntryHash>({
    cap_secret: null,
    cell_id: cellId1,
    zome_name: "crud",
    fn_name: "create",
    provenance: agent1PubKey,
    payload: entryContent,
  });
  const createdEntryHashB64 = Buffer.from(createEntryHash).toString("base64");
  t.equal(createEntryHash.length, 39);
  t.ok(createdEntryHashB64.startsWith("hCkk"));

  const readEntryResponse = await conductor.callZome<typeof entryContent>({
    cap_secret: null,
    cell_id: cellId2,
    zome_name: "crud",
    fn_name: "read",
    provenance: agent2PubKey,
    payload: createEntryHash,
  });
  t.equal(readEntryResponse, entryContent);

  await conductor.shutDown();
  await localTryCpServer.stop();
});

test("TryCP Scenario - Create and read an entry using the entry zome, 2 conductors, 2 cells, 2 agents", async (t) => {
  const localTryCpServer = await TryCpServer.start();

  const dnas: DnaSource[] = [{ path: FIXTURE_DNA_URL.pathname }];

  const conductor1 = await createTryCpConductor(
    `ws://${TRYCP_SERVER_HOST}:${TRYCP_SERVER_PORT}`,
    { partialConfig: LOCAL_TEST_PARTIAL_PLAYER_CONFIG }
  );
  const [alice] = await conductor1.installAgentsDnas({ agentsDnas: [dnas] });

  const conductor2 = await createTryCpConductor(
    `ws://${TRYCP_SERVER_HOST}:${TRYCP_SERVER_PORT}`,
    {
      partialConfig: LOCAL_TEST_PARTIAL_PLAYER_CONFIG,
      cleanAllConductors: false,
    }
  );
  const [bob] = await conductor2.installAgentsDnas({ agentsDnas: [dnas] });

  const entryContent = "test-content";
  const createEntry1Hash = await conductor1.callZome<EntryHash>({
    cap_secret: null,
    cell_id: alice.cells[0].cell_id,
    zome_name: "crud",
    fn_name: "create",
    provenance: alice.agentPubKey,
    payload: entryContent,
  });
  const createdEntry1HashB64 = Buffer.from(createEntry1Hash).toString("base64");
  t.equal(createEntry1Hash.length, 39);
  t.ok(createdEntry1HashB64.startsWith("hCkk"));

  await pause(1000);

  const readEntryResponse = await conductor2.callZome<typeof entryContent>({
    cap_secret: null,
    cell_id: bob.cells[0].cell_id,
    zome_name: "crud",
    fn_name: "read",
    provenance: bob.agentPubKey,
    payload: createEntry1Hash,
  });
  t.equal(readEntryResponse, entryContent);

  await conductor1.shutDown();
  await conductor2.shutDown();
  await localTryCpServer.stop();
});
