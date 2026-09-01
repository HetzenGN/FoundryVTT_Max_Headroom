// relay/extension/popup.js

// #region Constants

const MESSAGE_TYPES =
  Object.freeze({
    GET_STATUS:
      "MAX_HEADROOM_UI_GET_STATUS",

    PAIR_ACTIVE_TAB:
      "MAX_HEADROOM_UI_PAIR_ACTIVE_TAB",

    CLEAR_PAIRING:
      "MAX_HEADROOM_UI_CLEAR_PAIRING"
  });


const REFRESH_INTERVAL_MS =
  2500;

// #endregion


// #region Elements

const elements = {
  extensionVersion:
    document.getElementById(
      "extensionVersion"
    ),

  foundryIndicator:
    document.getElementById(
      "foundryIndicator"
    ),

  foundryStatus:
    document.getElementById(
      "foundryStatus"
    ),

  foundryDetails:
    document.getElementById(
      "foundryDetails"
    ),

  pairButton:
    document.getElementById(
      "pairButton"
    ),

  clearPairButton:
    document.getElementById(
      "clearPairButton"
    ),

  streamKitIndicator:
    document.getElementById(
      "streamKitIndicator"
    ),

  streamKitStatus:
    document.getElementById(
      "streamKitStatus"
    ),

  streamKitDetails:
    document.getElementById(
      "streamKitDetails"
    ),

  message:
    document.getElementById(
      "message"
    )
};

// #endregion


// #region Messaging

async function sendMessage(
  type
) {
  return chrome.runtime
    .sendMessage({
      type
    });
}

// #endregion


// #region Presentation Helpers

function setIndicator(
  element,
  state
) {
  element.dataset.state =
    state;
}


function showMessage(
  text,
  state = ""
) {
  elements.message.textContent =
    text;

  elements.message.hidden =
    !text;


  if (state) {
    elements.message.dataset.state =
      state;

  } else {
    delete elements
      .message
      .dataset
      .state;
  }
}


function formatAge(
  timestamp
) {
  const value =
    Number(timestamp);


  if (
    !Number.isFinite(
      value
    )
  ) {
    return "";
  }


  const seconds =
    Math.max(
      0,
      Math.floor(
        (
          Date.now()
          - value
        )
        / 1000
      )
    );


  if (seconds < 5) {
    return "just now";
  }


  if (seconds < 60) {
    return `${seconds}s ago`;
  }


  return `${Math.floor(
    seconds / 60
  )}m ago`;
}

// #endregion


// #region Rendering

function renderFoundry(
  status
) {
  const paired =
    status.paired;


  const activeFoundry =
    status.activeFoundry;


  if (paired?.valid) {
    setIndicator(
      elements.foundryIndicator,
      "good"
    );


    elements.foundryStatus
      .textContent =
        "Paired";


    const details = [];


    if (paired.worldTitle) {
      details.push(
        paired.worldTitle
      );
    }


    if (paired.userName) {
      details.push(
        paired.userName
      );
    }


    if (paired.moduleVersion) {
      details.push(
        `Module ${paired.moduleVersion}`
      );
    }


    elements.foundryDetails
      .textContent =
        details.join(" • ");


    elements.clearPairButton.hidden =
      false;

  } else {
    setIndicator(
      elements.foundryIndicator,
      activeFoundry
        ? "warning"
        : "bad"
    );


    elements.foundryStatus
      .textContent =
        activeFoundry
          ? "Ready to pair"
          : "Not paired";


    elements.foundryDetails
      .textContent =
        activeFoundry
          ? (
              activeFoundry.worldTitle
              || "Max Headroom detected in this tab."
            )
          : "Open your Foundry world, then use this popup from that tab.";


    elements.clearPairButton.hidden =
      true;
  }


  elements.pairButton.disabled =
    !activeFoundry;


  if (
    activeFoundry
    && paired?.valid
    && paired.tabId
      === activeFoundry.tabId
  ) {
    elements.pairButton.textContent =
      "Re-pair Current Foundry Tab";

  } else {
    elements.pairButton.textContent =
      "Pair Current Foundry Tab";
  }
}


function renderStreamKit(
  status
) {
  const streamKit =
    status.streamKit;


  if (
    streamKit?.connected
  ) {
    setIndicator(
      elements.streamKitIndicator,
      "good"
    );


    elements.streamKitStatus
      .textContent =
        "Connected";


    const details = [];


    if (streamKit.channelId) {
      details.push(
        `Channel ${streamKit.channelId}`
      );
    }


    const age =
      formatAge(
        streamKit.lastSeen
      );


    if (age) {
      details.push(
        `Heartbeat ${age}`
      );
    }


    elements.streamKitDetails
      .textContent =
        details.join(" • ");


    return;
  }


  if (
    streamKit?.state
      === "stale"
  ) {
    setIndicator(
      elements.streamKitIndicator,
      "warning"
    );


    elements.streamKitStatus
      .textContent =
        "Connection stale";


    elements.streamKitDetails
      .textContent =
        "Open or reload Discord StreamKit.";


    return;
  }


  setIndicator(
    elements.streamKitIndicator,
    "bad"
  );


  elements.streamKitStatus
    .textContent =
      "Not connected";


  elements.streamKitDetails
    .textContent =
      "Open StreamKit from the Max Headroom Relay Controller.";
}


function renderStatus(
  status
) {
  elements.extensionVersion
    .textContent =
      `v${status.extensionVersion}`;


  renderFoundry(
    status
  );


  renderStreamKit(
    status
  );
}

// #endregion


// #region Actions

async function refreshStatus() {
  try {
    const status =
      await sendMessage(
        MESSAGE_TYPES.GET_STATUS
      );


    if (!status?.ok) {
      throw new Error(
        "Unable to read relay status."
      );
    }


    renderStatus(
      status
    );

  } catch (error) {
    showMessage(
      error instanceof Error
        ? error.message
        : String(error),

      "error"
    );
  }
}


async function pairCurrentTab() {
  elements.pairButton.disabled =
    true;


  showMessage(
    "Pairing current Foundry tab…"
  );


  try {
    const result =
      await sendMessage(
        MESSAGE_TYPES
          .PAIR_ACTIVE_TAB
      );


    if (!result?.ok) {
      throw new Error(
        "This tab is not a ready Max Headroom Foundry world."
      );
    }


    showMessage(
      "Foundry tab paired.",
      "success"
    );


    await refreshStatus();

  } catch (error) {
    showMessage(
      error instanceof Error
        ? error.message
        : String(error),

      "error"
    );


    await refreshStatus();
  }
}


async function clearPairing() {
  try {
    await sendMessage(
      MESSAGE_TYPES
        .CLEAR_PAIRING
    );


    showMessage(
      "Foundry pairing cleared."
    );


    await refreshStatus();

  } catch (error) {
    showMessage(
      error instanceof Error
        ? error.message
        : String(error),

      "error"
    );
  }
}

// #endregion


// #region Startup

elements.pairButton
  .addEventListener(
    "click",
    pairCurrentTab
  );


elements.clearPairButton
  .addEventListener(
    "click",
    clearPairing
  );


refreshStatus();


globalThis.setInterval(
  refreshStatus,
  REFRESH_INTERVAL_MS
);

// #endregion