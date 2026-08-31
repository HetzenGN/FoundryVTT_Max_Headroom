// relay/extension/streamkit-main.js

(() => {
  "use strict";

  // #region Constants

  const INSTALL_FLAG =
    "__maxHeadroomExtensionStreamKitSourceInstalled";

  const PAGE_CHANNEL =
    "foundryvtt-max-headroom-extension";

  const SPEAKING_MESSAGE_TYPE =
    "streamkit-speaking-event";

  const USER_MESSAGE_TYPE =
    "streamkit-user-event";

  const SPEAKING_EVENTS =
    new Set([
      "SPEAKING_START",
      "SPEAKING_STOP"
    ]);

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


  // #region Helpers

  function normalizeId(
    value
  ) {
    if (
      typeof value !== "string"
      || !/^\d+$/.test(
        value.trim()
      )
    ) {
      return "";
    }

    return value.trim();
  }


  function normalizeOptionalText(
    value
  ) {
    if (
      value === undefined
      || value === null
    ) {
      return null;
    }

    const text =
      String(value).trim();

    return text || null;
  }


  function getOverlayIds() {
    const match =
      globalThis.location.pathname
        .match(
          /^\/overlay\/voice\/([^/]+)\/([^/]+)/
        );

    return {
      guildId:
        normalizeId(
          match?.[1]
        ),

      channelId:
        normalizeId(
          match?.[2]
        )
    };
  }


  const overlayIds =
    getOverlayIds();

  // #endregion


  // #region Speaking Translation

  function makeSpeakingPayload(
    rpcMessage
  ) {
    if (
      !rpcMessage
      || typeof rpcMessage
        !== "object"

      || !SPEAKING_EVENTS.has(
        rpcMessage.evt
      )
    ) {
      return null;
    }


    const data =
      rpcMessage.data;

    if (
      !data
      || typeof data !== "object"
    ) {
      return null;
    }


    const discordUserId =
      normalizeId(
        data.user_id
      );

    if (!discordUserId) {
      return null;
    }


    return {
      eventName:
        rpcMessage.evt,

      discordUserId,

      channelId:
        normalizeId(
          data.channel_id
        )
        || overlayIds.channelId,

      speaking:
        rpcMessage.evt
          === "SPEAKING_START",

      observedAt:
        Date.now()
    };
  }

  // #endregion


  // #region Discord User Translation

  function makeUserPayload(
    rpcMessage
  ) {
    if (
      !rpcMessage
      || typeof rpcMessage
        !== "object"

      || !USER_EVENTS.has(
        rpcMessage.evt
      )
    ) {
      return null;
    }


    const data =
      rpcMessage.data;

    if (
      !data
      || typeof data !== "object"
    ) {
      return null;
    }


    const discordUserId =
      normalizeId(
        data.user?.id
      );

    if (!discordUserId) {
      return null;
    }


    const voiceState =
      data.voice_state
      && typeof data.voice_state
        === "object"
        ? data.voice_state
        : {};


    return {
      eventName:
        rpcMessage.evt,

      discordUserId,

      username:
        normalizeOptionalText(
          data.user?.username
        ),

      nick:
        normalizeOptionalText(
          data.nick
        ),

      guildId:
        overlayIds.guildId,

      channelId:
        overlayIds.channelId,

      muted:
        Boolean(
          voiceState.mute
          || voiceState.self_mute
          || voiceState.suppress
        ),

      deafened:
        Boolean(
          voiceState.deaf
          || voiceState.self_deaf
        ),

      present:
        rpcMessage.evt
          !== "VOICE_STATE_DELETE",

      observedAt:
        Date.now()
    };
  }

  // #endregion


  // #region Page Transport

  function postPageMessage(
    type,
    payload
  ) {
    globalThis.postMessage(
      {
        channel:
          PAGE_CHANNEL,

        type,

        payload
      },
      globalThis.location.origin
    );
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
         * Confirmed against the current live
         * StreamKit Voice overlay.
         */
        const rpcMessage =
          args[1];


        const speakingPayload =
          makeSpeakingPayload(
            rpcMessage
          );


        if (speakingPayload) {
          postPageMessage(
            SPEAKING_MESSAGE_TYPE,
            speakingPayload
          );
        }


        const userPayload =
          makeUserPayload(
            rpcMessage
          );


        if (userPayload) {
          postPageMessage(
            USER_MESSAGE_TYPE,
            userPayload
          );
        }

      } catch (error) {
        console.warn(
          LOG_PREFIX,
          "Unable to inspect StreamKit RPC event.",
          error
        );
      }


      return result;
    };

  // #endregion


  // #region Startup

  console.info(
    LOG_PREFIX,
    "StreamKit MAIN-world source installed.",
    {
      guildId:
        overlayIds.guildId,

      channelId:
        overlayIds.channelId
    }
  );

  // #endregion
})();