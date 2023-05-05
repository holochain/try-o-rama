import {
  ActionHash,
  AppBundleSource,
  AppSignal,
  AppSignalCb,
  CloneId,
  EntryHash,
} from "@holochain/client";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "tape-promise/tape.js";
import {
  addAllAgentsToAllConductors,
  getZomeCaller,
  shutDownSignalingServer,
  spawnSignalingServer,
} from "../../src/common.js";
import {
  NetworkType,
  cleanAllConductors,
  createConductor,
} from "../../src/index.js";
import { awaitDhtSync } from "../../src/util.js";
import { FIXTURE_HAPP_URL } from "../fixture/index.js";

const ROLE_NAME = "test";

test("Local Conductor - spawn a conductor with WebRTC network", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  const conductor = await createConductor(serverUrl, {
    networkType: NetworkType.WebRtc,
    startup: false,
  });
  const tmpDirPath = conductor.getTmpDirectory();
  const conductorConfig = readFileSync(
    tmpDirPath + "/conductor-config.yaml"
  ).toString();
  t.ok(conductorConfig.includes("- type: webrtc"));

  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});

test("Local Conductor - spawn a conductor with mem network", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  const conductor = await createConductor(serverUrl, {
    networkType: NetworkType.Mem,
    startup: false,
  });
  const tmpDirPath = conductor.getTmpDirectory();
  const conductorConfig = readFileSync(
    tmpDirPath + "/conductor-config.yaml"
  ).toString();
  t.ok(conductorConfig.includes("transport_pool: []"));

  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});

test("Local Conductor - spawn a conductor with a bootstrap service", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  const bootstrapUrl = new URL("https://test.bootstrap.com");
  const conductor = await createConductor(serverUrl, {
    bootstrapUrl,
    startup: false,
  });
  const tmpDirPath = conductor.getTmpDirectory();
  const conductorConfig = readFileSync(
    tmpDirPath + "/conductor-config.yaml"
  ).toString();
  t.ok(conductorConfig.includes("network_type: quic_bootstrap"));
  t.ok(conductorConfig.includes(`bootstrap_service: ${bootstrapUrl.href}`));

  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});

test("Local Conductor - spawn a conductor and check for admin and app ws", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  const conductor = await createConductor(serverUrl);
  t.ok(conductor.adminWs());
  t.ok(conductor.appWs());

  await conductor.shutDown();
  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});

test("Local Conductor - get app info", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  const conductor = await createConductor(serverUrl);
  const alice = await conductor.installApp({
    path: FIXTURE_HAPP_URL.pathname,
  });
  const appInfo = await conductor.appWs().appInfo({
    installed_app_id: alice.appId,
  });
  t.deepEqual(appInfo.status, { running: null });
  await conductor.shutDown();
  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});

test("Local Conductor - install and call an app", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  const conductor = await createConductor(serverUrl);
  const app = await conductor.installApp({
    path: FIXTURE_HAPP_URL.pathname,
  });
  t.ok(app.appId);

  const entryContent = "Bye bye, world";
  const createEntryResponse: EntryHash = await app.cells[0].callZome({
    zome_name: "coordinator",
    fn_name: "create",
    payload: entryContent,
  });
  t.ok(createEntryResponse);
  const readEntryResponse: typeof entryContent = await app.cells[0].callZome({
    zome_name: "coordinator",
    fn_name: "read",
    payload: createEntryResponse,
  });
  t.equal(readEntryResponse, entryContent);

  await conductor.shutDown();
  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});

test("Local Conductor - get a convenience function for zome calls", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  const conductor = await createConductor(serverUrl);
  const [alice] = await conductor.installAgentsApps({
    agentsApps: [{ app: { path: FIXTURE_HAPP_URL.pathname } }],
  });

  const coordinatorZomeCall = getZomeCaller(alice.cells[0], "coordinator");
  t.equal(
    typeof coordinatorZomeCall,
    "function",
    "getZomeCaller returns a function"
  );

  const entryHeaderHash: ActionHash = await coordinatorZomeCall(
    "create",
    "test-entry"
  );
  const entryHeaderHashB64 = Buffer.from(entryHeaderHash).toString("base64");
  t.equal(entryHeaderHash.length, 39, "ActionHash is 39 bytes long");
  t.ok(entryHeaderHashB64.startsWith("hCkk"), "ActionHash starts with hCkk");

  await conductor.shutDown();
  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});

test("Local Conductor - install multiple agents and apps and get access to agents and cells", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  const conductor = await createConductor(serverUrl);
  const [alice, bob] = await conductor.installAgentsApps({
    agentsApps: [
      { app: { path: FIXTURE_HAPP_URL.pathname } },
      { app: { path: FIXTURE_HAPP_URL.pathname } },
    ],
  });
  alice.cells.forEach((cell) =>
    t.deepEqual(cell.cell_id[1], alice.agentPubKey)
  );
  bob.cells.forEach((cell) => t.deepEqual(cell.cell_id[1], bob.agentPubKey));

  await conductor.shutDown();
  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});

test("Local Conductor - get a named cell by role name", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  const conductor = await createConductor(serverUrl);
  const alice = await conductor.installApp({
    path: FIXTURE_HAPP_URL.pathname,
  });
  t.ok(alice.namedCells.get(ROLE_NAME), "dna role name matches");

  await conductor.shutDown();
  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});

test("Local Conductor - zome call can time out before completion", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  const conductor = await createConductor(serverUrl);
  const alice = await conductor.installApp({
    path: FIXTURE_HAPP_URL.pathname,
  });
  const cell = alice.namedCells.get(ROLE_NAME);
  assert(cell);
  const zome_name = "coordinator";
  const fn_name = "create";

  await t.rejects(cell.callZome({ zome_name, fn_name }, 1));

  await conductor.shutDown();
  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});

test("Local Conductor - create and read an entry using the entry zome", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  const conductor = await createConductor(serverUrl);

  const agentPubKey = await conductor.adminWs().generateAgentPubKey();
  const agentPubKeyB64 = Buffer.from(agentPubKey).toString("base64");
  t.equal(agentPubKey.length, 39);
  t.ok(agentPubKeyB64.startsWith("hCAk"));

  const installed_app_id = "entry-app";
  const alice = await conductor.installApp(
    { path: FIXTURE_HAPP_URL.pathname },
    {
      installedAppId: installed_app_id,
      agentPubKey,
    }
  );
  const { cell_id } = alice.cells[0];
  t.ok(Buffer.from(cell_id[0]).toString("base64").startsWith("hC0k"));
  t.ok(Buffer.from(cell_id[1]).toString("base64").startsWith("hCAk"));

  const entryContent = "test-content";
  const createEntryHash: EntryHash = await conductor.appWs().callZome({
    cap_secret: null,
    cell_id,
    zome_name: "coordinator",
    fn_name: "create",
    provenance: agentPubKey,
    payload: entryContent,
  });
  const createdEntryHashB64 = Buffer.from(createEntryHash).toString("base64");
  t.equal(createEntryHash.length, 39);
  t.ok(createdEntryHashB64.startsWith("hCkk"));

  const readEntryResponse: typeof entryContent = await conductor
    .appWs()
    .callZome({
      cap_secret: null,
      cell_id,
      zome_name: "coordinator",
      fn_name: "read",
      provenance: agentPubKey,
      payload: createEntryHash,
    });
  t.equal(readEntryResponse, entryContent);

  await conductor.shutDown();
  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});

test("Local Conductor - clone cell management", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  const conductor = await createConductor(serverUrl);
  const agentPubKey = await conductor.adminWs().generateAgentPubKey();
  const appId = "entry-app";
  const alice = await conductor.installApp(
    { path: FIXTURE_HAPP_URL.pathname },
    {
      installedAppId: appId,
      agentPubKey,
    }
  );

  const cloneCell = await conductor.appWs().createCloneCell({
    app_id: appId,
    role_name: ROLE_NAME,
    modifiers: { network_seed: "test-seed" },
  });
  t.deepEqual(
    cloneCell.clone_id,
    new CloneId(ROLE_NAME, 0).toString(),
    "clone id is 'role_name.0'"
  );
  t.deepEqual(
    cloneCell.cell_id[1],
    alice.cells[0].cell_id[1],
    "agent pub key in clone cell and base cell match"
  );

  const testContent = "test-content";
  const entryActionHash: ActionHash = await conductor.appWs().callZome({
    cell_id: cloneCell.cell_id,
    zome_name: "coordinator",
    fn_name: "create",
    payload: testContent,
    cap_secret: null,
    provenance: agentPubKey,
  });

  await conductor
    .appWs()
    .disableCloneCell({ app_id: appId, clone_cell_id: cloneCell.cell_id });
  await t.rejects(
    conductor.appWs().callZome({
      cell_id: cloneCell.cell_id,
      zome_name: "coordinator",
      fn_name: "read",
      payload: entryActionHash,
      cap_secret: null,
      provenance: agentPubKey,
    }),
    "disabled clone cell cannot be called"
  );

  const enabledCloneCell = await conductor
    .appWs()
    .enableCloneCell({ app_id: appId, clone_cell_id: cloneCell.clone_id });
  t.deepEqual(
    enabledCloneCell,
    cloneCell,
    "enabled clone cell matches created clone cell"
  );
  const readEntryResponse: typeof testContent = await conductor
    .appWs()
    .callZome(
      {
        cell_id: cloneCell.cell_id,
        zome_name: "coordinator",
        fn_name: "read",
        payload: entryActionHash,
        cap_secret: null,
        provenance: agentPubKey,
      },
      40000
    );
  t.equal(readEntryResponse, testContent, "enabled clone cell can be called");

  await conductor
    .appWs()
    .disableCloneCell({ app_id: appId, clone_cell_id: cloneCell.cell_id });
  await conductor
    .adminWs()
    .deleteCloneCell({ app_id: appId, clone_cell_id: cloneCell.cell_id });
  await t.rejects(
    conductor
      .appWs()
      .enableCloneCell({ app_id: appId, clone_cell_id: cloneCell.clone_id }),
    "deleted clone cell cannot be enabled"
  );

  await conductor.shutDown();
  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});

test("Local Conductor - 2 agent apps test", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  const app: AppBundleSource = { path: FIXTURE_HAPP_URL.pathname };

  const conductor1 = await createConductor(serverUrl);
  const conductor2 = await createConductor(serverUrl);
  const alice = await conductor1.installApp(app);
  const bob = await conductor2.installApp(app);

  await addAllAgentsToAllConductors([conductor1, conductor2]);

  const entryContent = "test-content";
  const createEntryHash: EntryHash = await alice.cells[0].callZome({
    zome_name: "coordinator",
    fn_name: "create",
    payload: entryContent,
  });

  // await pause(1000);

  await awaitDhtSync([conductor1, conductor2], alice.cells[0].cell_id);

  const readEntryResponse: typeof entryContent = await bob.cells[0].callZome({
    zome_name: "coordinator",
    fn_name: "read",
    payload: createEntryHash,
  });
  t.equal(readEntryResponse, entryContent);

  await conductor1.shutDown();
  await conductor2.shutDown();
  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});

test("Local Conductor - create and read an entry using the entry zome, 2 conductors, 2 cells, 2 agents", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  const app: AppBundleSource = { path: FIXTURE_HAPP_URL.pathname };

  const conductor1 = await createConductor(serverUrl);
  const conductor2 = await createConductor(serverUrl);
  const alice = await conductor1.installApp(app);
  const bob = await conductor2.installApp(app);

  await addAllAgentsToAllConductors([conductor1, conductor2]);

  const entryContent = "test-content";
  const createEntryHash: EntryHash = await alice.cells[0].callZome({
    zome_name: "coordinator",
    fn_name: "create",
    payload: entryContent,
  });
  const createdEntryHashB64 = Buffer.from(createEntryHash).toString("base64");
  t.equal(createEntryHash.length, 39);
  t.ok(createdEntryHashB64.startsWith("hCkk"));

  await awaitDhtSync([conductor1, conductor2], alice.cells[0].cell_id);

  const readEntryResponse: typeof entryContent = await bob.cells[0].callZome({
    zome_name: "coordinator",
    fn_name: "read",
    payload: createEntryHash,
  });
  t.equal(readEntryResponse, entryContent);

  await conductor1.shutDown();
  await conductor2.shutDown();
  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});

test("Local Conductor - Receive a signal", async (t) => {
  const [serverProcess, serverUrl] = await spawnSignalingServer();
  let signalHandler: AppSignalCb | undefined;
  const signalReceived = new Promise<AppSignal>((resolve) => {
    signalHandler = (signal) => {
      resolve(signal);
    };
  });
  const conductor = await createConductor(serverUrl);

  const alice = await conductor.installApp({ path: FIXTURE_HAPP_URL.pathname });

  assert(signalHandler);
  conductor.appWs().on("signal", signalHandler);
  const aliceSignal = { value: "signal" };
  alice.cells[0].callZome({
    zome_name: "coordinator",
    fn_name: "signal_loopback",
    payload: aliceSignal,
  });
  const actualSignal = await signalReceived;
  t.deepEqual(actualSignal.payload, aliceSignal);

  await conductor.shutDown();
  await shutDownSignalingServer(serverProcess);
  await cleanAllConductors();
});
