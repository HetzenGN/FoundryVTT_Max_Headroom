// relay/extension/streamkit-bridge.js

(() => {
  "use strict";

  // #region Constants

  const INSTALL_FLAG =
    "__maxHeadroomExtensionStreamKitBridgeInstalled";

  const PAGE_CHANNEL =
    "foundryvtt-max-headroom-extension";

  const PAGE_SPEAKING_TYPE =
    "streamkit-speaking-event";

  const PAGE_USER_TYPE =
    "streamkit-user-event";

  const EXTENSION_SPEAKING_TYPE =
    "MAX_HEADROOM_STREAMKIT_SPEAKING";

  const EXTENSION_USER_TYPE =
    "MAX_HEADROOM_STREAMKIT_USER";

  const EXTENSION_HEALTH_TYPE =
  "MAX_HEADROOM_STREAMKIT_HEALTH";


  const HEALTH_HEARTBEAT_INTERVAL_MS =
    5000;

  const USER_EVENTS =
    new Set([
      "VOICE_STATE_CREATE",
      "VOICE_STATE_UPDATE",
      "VOICE_STATE_DELETE"
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


  // #region Validation

  function isValidDiscordId(
    value
  ) {
    return (
      typeof value === "string"
      && /^\d+$/.test(value)
    );
  }


  function isValidSpeakingPayload(
    payload
  ) {
    return Boolean(
      payload
      && typeof payload
        === "object"

      && (
        payload.eventName
          === "SPEAKING_START"
        || payload.eventName
          === "SPEAKING_STOP"
      )

      && isValidDiscordId(
        payload.discordUserId
      )

      && isValidDiscordId(
        payload.channelId
      )

      && typeof payload.speaking
        === "boolean"

      && Number.isFinite(
        payload.observedAt
      )
    );
  }


  function isValidUserPayload(
    payload
  ) {
    return Boolean(
      payload
      && typeof payload
        === "object"

      && USER_EVENTS.has(
        payload.eventName
      )

      && isValidDiscordId(
        payload.discordUserId
      )

      && isValidDiscordId(
        payload.guildId
      )

      && isValidDiscordId(
        payload.channelId
      )

      && typeof payload.present
        === "boolean"

      && Number.isFinite(
        payload.observedAt
      )
    );
  }

  // #endregion


  // #region Extension Transport

  function sendToExtension(
    type,
    payload
  ) {
    chrome.runtime
      .sendMessage({
        type,
        payload
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

  // #endregion

  // #region Health

function getStreamKitChannelId() {
  const match =
    globalThis.location.pathname
      .match(
        /^\/overlay\/voice\/[^/]+\/([^/]+)/
      );


  const channelId =
    String(
      match?.[1]
      ?? ""
    ).trim();


  return /^\d+$/.test(
    channelId
  )
    ? channelId
    : "";
}


function sendHealth(
  state
) {
  const channelId =
    getStreamKitChannelId();


  if (!channelId) {
    return;
  }


  sendToExtension(
    EXTENSION_HEALTH_TYPE,
    {
      state,

      channelId,

      observedAt:
        Date.now()
    }
  );
}


let healthHeartbeatTimer =
  globalThis.setInterval(
    () => {
      sendHealth(
        "heartbeat"
      );
    },
    HEALTH_HEARTBEAT_INTERVAL_MS
  );


function stopHealthHeartbeat() {
  if (
    healthHeartbeatTimer === null
  ) {
    return;
  }


  globalThis.clearInterval(
    healthHeartbeatTimer
  );


  healthHeartbeatTimer =
    null;
}


// #endregion

  // #region Page Bridge

  globalThis.addEventListener(
    "message",
    (event) => {
      if (
        event.source
          !== globalThis

        || event.origin
          !== globalThis.location.origin
      ) {
        return;
      }


      const message =
        event.data;


      if (
        !message
        || typeof message
          !== "object"

        || message.channel
          !== PAGE_CHANNEL
      ) {
        return;
      }


      if (
        message.type
          === PAGE_SPEAKING_TYPE
      ) {
        if (
          !isValidSpeakingPayload(
            message.payload
          )
        ) {
          return;
        }

        sendToExtension(
          EXTENSION_SPEAKING_TYPE,
          message.payload
        );

        return;
      }


      if (
        message.type
          === PAGE_USER_TYPE
      ) {
        if (
          !isValidUserPayload(
            message.payload
          )
        ) {
          return;
        }

        sendToExtension(
          EXTENSION_USER_TYPE,
          message.payload
        );
      }
    }
  );

  // #endregion


// #region Startup

sendHealth(
  "ready"
);


globalThis.addEventListener(
  "pagehide",
  () => {
    stopHealthHeartbeat();

    sendHealth(
      "disconnected"
    );
  },
  {
    once: true
  }
);


console.info(
  LOG_PREFIX,
  "StreamKit extension bridge installed."
);

// #endregion
})();