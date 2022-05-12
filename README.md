# Tryorama

An end-to-end/scenario testing framework for Holochain applications, written in
TypeScript.

[![Project](https://img.shields.io/badge/Project-Holochain-blue.svg?style=flat-square)](http://holochain.org/)
[![Forum](https://img.shields.io/badge/Forum-forum%2eholochain%2enet-blue.svg?style=flat-square)](https://forum.holochain.org)
[![License: CAL 1.0](https://img.shields.io/badge/License-CAL%201.0-blue.svg)](https://github.com/holochain/cryptographic-autonomy-license)
![Test](https://github.com/holochain/holochain-client-js/actions/workflows/test.yml/badge.svg?branch=main)

Tryorama provides a convenient way to run an arbitrary amount of Holochain
conductors on your local machine, as well as on network nodes that are running
the TryCP service. In combination with the test runner and assertion library of
your choice, you can test the behavior of multiple Holochain nodes in a
network. Included functions to clean up used resources make sure that all state
is deleted between tests so that they are independent of one another.

```sh
npm install @holochain/tryorama
```

[Complete API reference](./docs/tryorama.md)

## Example

With a few lines of code you can start testing your Holochain application. This
example uses [tape](https://github.com/substack/tape) as test runner and
assertion library. You can choose any other library you want.

```typescript
import test from "tape";
import { Scenario, pause, runScenario } from "../../../lib";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { EntryHash } from "@holochain/client";

test("Create 2 players and create and read an entry", async (t) => {
  runScenario(async (scenario: Scenario) => {
    // Construct proper paths for your DNAs
    // This assumes DNA files created by the `hc dna pack` command
    const testDnaPath = dirname(fileURLToPath(import.meta.url)) + "/test.dna";

    // Add 2 players to the Scenario and specify only one DNA for each, being the
    // test DNA. The returned players can be destructured.
    const [alice, bob] = await scenario.addPlayersWithHapps([
      [{ path: testDnaPath }],
      [{ path: testDnaPath }],
    ]);

    // Content to be passed to the zome function that create an entry
    const content = "Hello Tryorama";

    // The cells of the installed hApp are returned in the same order as the DNAs
    // that were passed into the player creation.
    const createEntryHash = await alice.cells[0].callZome<EntryHash>({
      zome_name: "crud",
      fn_name: "create",
      payload: content,
    });

    // Wait for the created entry to be propagated to the other node.
    await pause(500);

    // Using the same cell and zome as before, the second player reads the
    // created entry.
    const readContent = await bob.cells[0].callZome<typeof content>({
      zome_name: "crud",
      fn_name: "read",
      payload: createEntryHash,
    });
    t.equal(readContent, content);
  });
});
```

Written out without the wrapper function, the same example looks like this:

```typescript
import test from "tape";
import { Scenario, pause } from "@holochain/tryorama";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { EntryHash } from "@holochain/client";

test("Create 2 players and create and read an entry", async (t) => {
  const testDnaPath = dirname(fileURLToPath(import.meta.url)) + "/test.dna";

  // Create a Scenario that uses conductors on the localhost
  const scenario = new Scenario();

  const [alice, bob] = await scenario.addPlayersWithHapps([
    [{ path: testDnaPath }],
    [{ path: testDnaPath }],
  ]);

  const content = "Hello Tryorama";
  const createEntryHash = await alice.cells[0].callZome<EntryHash>({
    zome_name: "crud",
    fn_name: "create",
    payload: content,
  });

  await pause(500);

  const readContent = await bob.cells[0].callZome<typeof content>({
    zome_name: "crud",
    fn_name: "read",
    payload: createEntryHash,
  });
  t.equal(readContent, content);

  // Shut down all conductors and delete their files and directories.
  await scenario.cleanUp();
});
```

> The wrapper takes care of creating a scenario, logging any error that occurs
while running the test and shutting down or deleting all conductors involved in
the test scenario.

Have a look at the [tests](./ts/test/local/scenario.ts) for many more examples.

## Concepts

[Scenarios](./docs/tryorama.scenario.md) provide high-level functions to
interact with the Holochain Conductor API. [Players](./docs/tryorama.player.md)
consist of a conductor, an agent and installed hApps, and can be added to a
Scenario. Access to installed hApps is made available through the cells,
which can either be destructured according to the sequence during installation
or retrieved by their role id.

One level underneath the Scenario is the
[Conductor](./docs/tryorama.localconductor.md). Apart from methods for
creation, startup and shutdown, it comes with complete functionality of Admin
and App API that the JavaScript client offers.

## hApp Installation

Conductors are equipped with a method for easy hApp installation,
[installAgentsHapps](./docs/tryorama.conductor.installagentshapps.md). It has a
almost identical signature to `Scenario.addPlayers` and takes an array of DNAs
for each agent, resulting in a 2-dimensional array, e. g.
`[[agent1dna1, agent1dna2], [agent2dna1], [agent3dna1, agent3dna2, agent3dna3]]`.

```typescript
const testDnaPath = dirname(fileURLToPath(import.meta.url)) + "/test.dna";
const dnas: DnaSource[] = [{ path: testDnaPath }];

const conductor = await createLocalConductor();
const [aliceHapps] = await conductor.installAgentsHapps({
  agentsDnas: [dnas],
});
await conductor.attachAppInterface();
await conductor.connectAppInterface();

const entryContent = "test-content";
const createEntryHash = await aliceHapps.cells[0].callZome<EntryHash>({
  zome_name: "crud",
  fn_name: "create",
  payload: entryContent,
});

await conductor.shutDown();
```

## Signals

`Scenario.addPlayer` as well as `Conductor.installAgentsHapps` allow for an
optional signal handler to be specified. Signal handlers are registered with
the conductor and act as a callback when a signal is received.

```typescript
const scenario = new LocalScenario();
const testDnaPath = dirname(fileURLToPath(import.meta.url)) + "/test.dna";
const dnas: DnaSource[] = [{ path: testDnaPath }];
d
let signalHandler: AppSignalCb | undefined;
const signalReceived = new Promise<AppSignal>((resolve) => {
  signalHandler = (signal) => {
    resolve(signal);
  };
});

const alice = await scenario.addPlayerWithHapp(dna, signalHandler);

const signal = { value: "hello alice" };
alice.cells[0].callZome({
  zome_name: "crud",
  fn_name: "signal_loopback",
  payload: signal,
});

const actualSignalAlice = await signalReceived;
t.deepEqual(actualSignalAlice.data.payload, signal);

await scenario.cleanUp();
```
