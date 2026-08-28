// relay/extension/streamkit-main.js

(() => {
  "use strict";

  // #region Constants

  const INSTALL_FLAG =
    "__maxHeadroomExtensionStreamKitSourceInstalled";

  const PAGE_CHANNEL =
    "foundryvtt-max-headroom-extension";

  const PAGE_MESSAGE_TYPE =
    "streamkit-speaking-event";

  const SPEAKING_EVENTS =
    new Set([
      "SPEAKING_START",
      "SPEAKING_STOP"
    ]);

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


  // #region Helpers

  function normalizeDiscordId(
    value
  ) {
    if (
      typeof value !== "string"
      || !value.trim()
    ) {
      return "";
    }

    return value.trim();
  }


  function makeSpeakingPayload(
    rpcMessage
  ) {
    if (
      !rpcMessage
      || typeof rpcMessage
        !== "object"
    ) {
      return null;
    }

    const eventName =
      rpcMessage.evt;

    if (
      !SPEAKING_EVENTS.has(
        eventName
      )
    ) {
      return null;
    }

    const data =
      rpcMessage.data;

    if (
      !data
      || typeof data
        !== "object"
    ) {
      return null;
    }

    const discordUserId =
      normalizeDiscordId(
        data.user_id
      );

    if (!discordUserId) {
      return null;
    }

    const channelId =
      normalizeDiscordId(
        data.channel_id
      );

    return {
      eventName,

      discordUserId,

      channelId:
        channelId || null,

      speaking:
        eventName
        === "SPEAKING_START",

      observedAt:
        Date.now()
    };
  }

  // #endregion


  // #region StreamKit Console Interception

  const originalLog =
    console.log;


  console.log =
    function (...args) {
      const result =
        Reflect.apply(
          originalLog,
          this,
          args
        );

      try {
        /*
         * Current StreamKit logs the RPC object as
         * the second console.log argument.
         *
         * This was confirmed against the live
         * StreamKit Voice overlay.
         */
        const rpcMessage =
          args[1];

        const payload =
          makeSpeakingPayload(
            rpcMessage
          );

        if (!payload) {
          return result;
        }

        window.postMessage(
          {
            channel:
              PAGE_CHANNEL,

            type:
              PAGE_MESSAGE_TYPE,

            payload
          },
          globalThis.location.origin
        );

      } catch (error) {
        console.warn(
          LOG_PREFIX,
          "Unable to inspect StreamKit console event.",
          error
        );
      }

      return result;
    };

  // #endregion


  // #region Startup

  console.info(
    LOG_PREFIX,
    "StreamKit MAIN-world source installed."
  );

  // #endregion
})();