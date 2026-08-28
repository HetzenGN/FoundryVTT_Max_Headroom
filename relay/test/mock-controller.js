// relay/test/mock-controller.js

// #region Imports

import {
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  MESSAGE_SOURCES
} from "../../shared/protocol.js";

import {
  BOOTSTRAP_QUERY_KEYS
} from "../src/bootstrap.js";

// #endregion


// #region Constants

const RELAY_ORIGIN =
  "http://127.0.0.1:8081";

const RELAY_URL =
  `${RELAY_ORIGIN}/relay/test/mock-streamkit.html`;

const POPUP_NAME =
  "max-headroom-mock-relay";

const MAX_MESSAGE_AGE_MS =
  60000;

const MAX_FUTURE_SKEW_MS =
  5000;

const ACCEPTED_TYPES =
  new Set([
    MESSAGE_TYPES.RELAY_READY,
    MESSAGE_TYPES.RELAY_HEARTBEAT,
    MESSAGE_TYPES.DISCORD_SPEAKING,
    MESSAGE_TYPES.RELAY_ERROR,
    MESSAGE_TYPES.RELAY_DEBUG
  ]);

// #endregion


// #region Runtime State

let popupWindow = null;
let currentNonce = null;

// #endregion


// #region Elements

const controllerOriginElement =
  document.getElementById(
    "controller-origin"
  );

const relayOriginElement =
  document.getElementById(
    "relay-origin"
  );

const nonceElement =
  document.getElementById(
    "nonce"
  );

const acceptedLogElement =
  document.getElementById(
    "accepted-log"
  );

const rejectedLogElement =
  document.getElementById(
    "rejected-log"
  );

// #endregion


// #region Helpers

function generateNonce() {
  const bytes =
    new Uint8Array(24);

  globalThis.crypto.getRandomValues(
    bytes
  );

  return Array.from(
    bytes,
    (byte) =>
      byte
        .toString(16)
        .padStart(2, "0")
  ).join("");
}


function isFreshTimestamp(
  timestamp
) {
  const value =
    Number(timestamp);

  if (!Number.isFinite(value)) {
    return false;
  }

  const now =
    Date.now();

  if (
    value
    > now + MAX_FUTURE_SKEW_MS
  ) {
    return false;
  }

  if (
    now - value
    > MAX_MESSAGE_AGE_MS
  ) {
    return false;
  }

  return true;
}


function appendLog(
  element,
  label,
  value
) {
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(
          value,
          null,
          2
        );

  element.textContent +=
    `[${new Date().toLocaleTimeString()}] ${label}\n${text}\n\n`;
}

// #endregion


// #region Popup Management

function openRelay({
  protocolVersion =
    PROTOCOL_VERSION
} = {}) {
  if (
    popupWindow
    && !popupWindow.closed
  ) {
    popupWindow.close();
  }

  currentNonce =
    generateNonce();

  nonceElement.textContent =
    currentNonce;

  const url =
    new URL(RELAY_URL);

  url.searchParams.set(
    BOOTSTRAP_QUERY_KEYS.NONCE,
    currentNonce
  );

  url.searchParams.set(
    BOOTSTRAP_QUERY_KEYS.PROTOCOL,
    String(protocolVersion)
  );

  url.searchParams.set(
    BOOTSTRAP_QUERY_KEYS.OPENER_ORIGIN,
    globalThis.location.origin
  );

  popupWindow =
    globalThis.open(
      url.toString(),
      POPUP_NAME,
      [
        "popup=yes",
        "width=900",
        "height=700",
        "resizable=yes",
        "scrollbars=yes"
      ].join(",")
    );

  if (!popupWindow) {
    appendLog(
      rejectedLogElement,
      "POPUP BLOCKED",
      "Browser prevented the mock relay popup from opening."
    );
  }
}


function closeRelay() {
  if (
    popupWindow
    && !popupWindow.closed
  ) {
    popupWindow.close();
  }

  popupWindow = null;
}

// #endregion


// #region Message Validation

function validateMessage(event) {
  if (
    event.origin
    !== RELAY_ORIGIN
  ) {
    return {
      valid: false,
      reason:
        `Unexpected origin: ${event.origin}`
    };
  }

  if (
    !popupWindow
    || event.source !== popupWindow
  ) {
    return {
      valid: false,
      reason:
        "Message source is not the tracked relay popup."
    };
  }

  const payload =
    event.data;

  if (
    !payload
    || typeof payload !== "object"
  ) {
    return {
      valid: false,
      reason:
        "Payload is not an object."
    };
  }

  if (
    payload.version
    !== PROTOCOL_VERSION
  ) {
    return {
      valid: false,
      reason:
        `Protocol version ${String(payload.version)} is incompatible.`
    };
  }

  if (
    !ACCEPTED_TYPES.has(
      payload.type
    )
  ) {
    return {
      valid: false,
      reason:
        `Unrecognized message type: ${String(payload.type)}`
    };
  }

  if (
    payload.nonce
    !== currentNonce
  ) {
    return {
      valid: false,
      reason:
        "Relay nonce does not match the current session."
    };
  }

  if (
    payload.source
    !== MESSAGE_SOURCES.STREAMKIT
  ) {
    return {
      valid: false,
      reason:
        `Unexpected message source: ${String(payload.source)}`
    };
  }

  if (
    !isFreshTimestamp(
      payload.timestamp
    )
  ) {
    return {
      valid: false,
      reason:
        "Relay timestamp is stale or invalid."
    };
  }

  return {
    valid: true,
    payload
  };
}


function onWindowMessage(event) {
  const validation =
    validateMessage(event);

  if (!validation.valid) {
    appendLog(
      rejectedLogElement,
      "REJECTED",
      {
        reason:
          validation.reason,

        payload:
          event.data
      }
    );

    return;
  }

  appendLog(
    acceptedLogElement,
    "ACCEPTED",
    validation.payload
  );
}

// #endregion


// #region UI

controllerOriginElement.textContent =
  globalThis.location.origin;

relayOriginElement.textContent =
  RELAY_ORIGIN;

document
  .getElementById("open-relay")
  .addEventListener(
    "click",
    () => {
      openRelay();
    }
  );

document
  .getElementById(
    "open-bad-protocol"
  )
  .addEventListener(
    "click",
    () => {
      openRelay({
        protocolVersion: 999
      });
    }
  );

document
  .getElementById("close-relay")
  .addEventListener(
    "click",
    closeRelay
  );

document
  .getElementById("clear-log")
  .addEventListener(
    "click",
    () => {
      acceptedLogElement.textContent =
        "";

      rejectedLogElement.textContent =
        "";
    }
  );

// #endregion


// #region Initialization

globalThis.addEventListener(
  "message",
  onWindowMessage
);

// #endregion