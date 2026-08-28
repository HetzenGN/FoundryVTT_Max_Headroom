// relay/src/heartbeat.js

// #region Imports

import {
  MESSAGE_SOURCES,
  makeRelayHeartbeat
} from "../../shared/protocol.js";

// #endregion


// #region Constants

export const DEFAULT_HEARTBEAT_INTERVAL_MS =
  5000;

// #endregion


// #region Heartbeat

export function startHeartbeat({
  nonce,
  transport,
  scriptVersion,
  intervalMs =
    DEFAULT_HEARTBEAT_INTERVAL_MS
} = {}) {
  let timer = null;

  function sendHeartbeat() {
    const payload = {
      ...makeRelayHeartbeat({
        nonce,
        source:
          MESSAGE_SOURCES.STREAMKIT
      }),

      scriptVersion
    };

    const sent =
      transport.send(payload);

    if (!sent) {
      const state =
        transport.getState();

      /*
       * Do not leave an interval repeatedly failing after
       * the Foundry opener has gone away.
       */
      if (
        !state.openerAvailable
        || state.openerClosed
      ) {
        stop();
      }
    }

    return sent;
  }


  function start() {
    if (timer !== null) {
      return;
    }

    timer =
      globalThis.setInterval(
        sendHeartbeat,
        intervalMs
      );
  }


  function stop() {
    if (timer === null) {
      return;
    }

    globalThis.clearInterval(
      timer
    );

    timer = null;
  }


  function getState() {
    return {
      running:
        timer !== null,

      intervalMs
    };
  }


  start();

  return Object.freeze({
    sendHeartbeat,
    stop,
    getState
  });
}

// #endregion