// relay/test/mock-streamkit.js

// #region Imports

import "../src/main.js";

// #endregion


// #region Test Users

/*
 * These are deliberately larger than
 * Number.MAX_SAFE_INTEGER.
 *
 * Keep them as strings at all times.
 */

const ALICE_ID =
  "123456789012345678";

const BOB_ID =
  "234567890123456789";

const UNKNOWN_ID =
  "345678901234567890";


const ALICE_OPTIONS = {
  username:
    "alice",

  nick:
    "Alice",

  muted:
    false,

  deafened:
    false,

  channelId:
    "456789012345678901",

  guildId:
    "567890123456789012"
};


const BOB_OPTIONS = {
  username:
    "bob",

  nick:
    "Bob",

  muted:
    false,

  deafened:
    false,

  channelId:
    "456789012345678901",

  guildId:
    "567890123456789012"
};

// #endregion


// #region Elements

const runtimeStateElement =
  document.getElementById(
    "runtime-state"
  );

// #endregion


// #region Helpers

function getDebugApi() {
  return globalThis
    .__maxHeadroomStreamKitRelayDebug
    ?? null;
}


function renderState() {
  const debug =
    getDebugApi();

  const state =
    debug
      ?.getRuntimeState()
      ?? {
        started: false,

        error:
          "Relay debug API unavailable."
      };

  runtimeStateElement.textContent =
    JSON.stringify(
      state,
      null,
      2
    );
}


function run(action) {
  action(
    getDebugApi()
  );

  renderState();
}

// #endregion


// #region Relay Controls

document
  .getElementById(
    "send-ready"
  )
  .addEventListener(
    "click",
    () => {
      run(
        (debug) =>
          debug?.sendReady()
      );
    }
  );


document
  .getElementById(
    "send-heartbeat"
  )
  .addEventListener(
    "click",
    () => {
      run(
        (debug) =>
          debug?.sendHeartbeat()
      );
    }
  );

// #endregion


// #region Alice Controls

document
  .getElementById(
    "alice-appear"
  )
  .addEventListener(
    "click",
    () => {
      run(
        (debug) =>
          debug?.emitFakeUser(
            ALICE_ID,
            ALICE_OPTIONS
          )
      );
    }
  );


document
  .getElementById(
    "alice-start"
  )
  .addEventListener(
    "click",
    () => {
      run(
        (debug) =>
          debug?.emitFakeSpeaking(
            ALICE_ID,
            true,
            ALICE_OPTIONS
          )
      );
    }
  );


document
  .getElementById(
    "alice-duplicate"
  )
  .addEventListener(
    "click",
    () => {
      run(
        (debug) =>
          debug?.emitFakeSpeaking(
            ALICE_ID,
            true,
            ALICE_OPTIONS
          )
      );
    }
  );


document
  .getElementById(
    "alice-stop"
  )
  .addEventListener(
    "click",
    () => {
      run(
        (debug) =>
          debug?.emitFakeSpeaking(
            ALICE_ID,
            false,
            ALICE_OPTIONS
          )
      );
    }
  );


document
  .getElementById(
    "alice-mute"
  )
  .addEventListener(
    "click",
    () => {
      run(
        (debug) =>
          debug?.emitFakeMute(
            ALICE_ID,
            true,
            ALICE_OPTIONS
          )
      );
    }
  );


document
  .getElementById(
    "alice-unmute"
  )
  .addEventListener(
    "click",
    () => {
      run(
        (debug) =>
          debug?.emitFakeMute(
            ALICE_ID,
            false,
            ALICE_OPTIONS
          )
      );
    }
  );


document
  .getElementById(
    "alice-deafen"
  )
  .addEventListener(
    "click",
    () => {
      run(
        (debug) =>
          debug?.emitFakeDeafen(
            ALICE_ID,
            true,
            ALICE_OPTIONS
          )
      );
    }
  );


document
  .getElementById(
    "alice-undeafen"
  )
  .addEventListener(
    "click",
    () => {
      run(
        (debug) =>
          debug?.emitFakeDeafen(
            ALICE_ID,
            false,
            ALICE_OPTIONS
          )
      );
    }
  );

// #endregion


// #region Bob / Other Controls

document
  .getElementById(
    "bob-start"
  )
  .addEventListener(
    "click",
    () => {
      run(
        (debug) =>
          debug?.emitFakeSpeaking(
            BOB_ID,
            true,
            BOB_OPTIONS
          )
      );
    }
  );


document
  .getElementById(
    "bob-stop"
  )
  .addEventListener(
    "click",
    () => {
      run(
        (debug) =>
          debug?.emitFakeSpeaking(
            BOB_ID,
            false,
            BOB_OPTIONS
          )
      );
    }
  );


document
  .getElementById(
    "unknown-start"
  )
  .addEventListener(
    "click",
    () => {
      run(
        (debug) =>
          debug?.emitFakeSpeaking(
            UNKNOWN_ID,
            true,
            {
              username:
                "unknown-user",

              nick:
                "Unknown"
            }
          )
      );
    }
  );


document
  .getElementById(
    "malformed-event"
  )
  .addEventListener(
    "click",
    () => {
      run(
        (debug) =>
          debug
            ?.emitMalformedFakeEvent()
      );
    }
  );

// #endregion


// #region Initialization

renderState();

globalThis.setInterval(
  renderState,
  1000
);

// #endregion