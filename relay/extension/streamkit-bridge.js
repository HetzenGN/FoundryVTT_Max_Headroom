// relay/extension/streamkit-bridge.js

(() => {
  "use strict";

  // #region Constants

  const INSTALL_FLAG =
    "__maxHeadroomExtensionStreamKitBridgeInstalled";

  const PAGE_CHANNEL =
    "foundryvtt-max-headroom-extension";

  const PAGE_MESSAGE_TYPE =
    "streamkit-speaking-event";

  const EXTENSION_MESSAGE_TYPE =
    "MAX_HEADROOM_STREAMKIT_SPEAKING";

  const LOG_PREFIX =
    "[Max Headroom extension]";

  // #endregion


  // #region Installation Guard

  if (globalThis[INSTALL_FLAG]) {
    return;
  }

  globalThis[INSTALL_FLAG] =
    true;

  // #endregion


  // #region Validation

  function isValidPayload(
    payload
  ) {
    if (
      !payload
      || typeof payload
        !== "object"
    ) {
      return false;
    }

    if (
      payload.eventName
        !== "SPEAKING_START"
      && payload.eventName
        !== "SPEAKING_STOP"
    ) {
      return false;
    }

    if (
      typeof payload.discordUserId
        !== "string"
      || !/^\d+$/.test(
        payload.discordUserId
      )
    ) {
      return false;
    }

    if (
      typeof payload.speaking
        !== "boolean"
    ) {
      return false;
    }

    if (
      !Number.isFinite(
        payload.observedAt
      )
    ) {
      return false;
    }

    return true;
  }

  // #endregion


  // #region Page Bridge

  globalThis.addEventListener(
    "message",
    (event) => {
      if (
        event.source
        !== globalThis
      ) {
        return;
      }

      if (
        event.origin
        !== globalThis
          .location.origin
      ) {
        return;
      }

      const message =
        event.data;

      if (
        !message
        || typeof message
          !== "object"
      ) {
        return;
      }

      if (
        message.channel
          !== PAGE_CHANNEL
        || message.type
          !== PAGE_MESSAGE_TYPE
      ) {
        return;
      }

      if (
        !isValidPayload(
          message.payload
        )
      ) {
        console.warn(
          LOG_PREFIX,
          "Rejected malformed StreamKit page event."
        );

        return;
      }

      chrome.runtime
        .sendMessage({
          type:
            EXTENSION_MESSAGE_TYPE,

          payload:
            message.payload
        })
        .catch(
          (error) => {
            console.warn(
              LOG_PREFIX,
              "Unable to send StreamKit event to extension service worker.",
              error
            );
          }
        );
    }
  );

  // #endregion


  // #region Startup

  console.info(
    LOG_PREFIX,
    "StreamKit extension bridge installed."
  );

  // #endregion
})();