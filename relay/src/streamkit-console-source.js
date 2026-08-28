// relay/src/streamkit-console-source.js

// #region Constants

const CONSOLE_METHODS =
  Object.freeze([
    "log",
    "info",
    "debug",
    "warn",
    "error"
  ]);


const RPC_EVENTS =
  Object.freeze({
    VOICE_STATE_CREATE:
      "VOICE_STATE_CREATE",

    VOICE_STATE_UPDATE:
      "VOICE_STATE_UPDATE",

    VOICE_STATE_DELETE:
      "VOICE_STATE_DELETE",

    SPEAKING_START:
      "SPEAKING_START",

    SPEAKING_STOP:
      "SPEAKING_STOP"
  });


const RECOGNIZED_RPC_EVENTS =
  new Set(
    Object.values(
      RPC_EVENTS
    )
  );

// #endregion


// #region Helpers

function normalizeString(value) {
  if (
    typeof value !== "string"
    || !value.trim()
  ) {
    return undefined;
  }

  return value.trim();
}


function parseOverlayIds(
  location
) {
  const pathname =
    String(
      location?.pathname
      ?? ""
    );

  const match =
    pathname.match(
      /^\/overlay\/voice\/([^/]+)\/([^/]+)/
    );

  if (!match) {
    return {
      guildId:
        undefined,

      channelId:
        undefined
    };
  }

  return {
    guildId:
      normalizeString(
        match[1]
      ),

    channelId:
      normalizeString(
        match[2]
      )
  };
}


function getVoiceFlags(data) {
  const voiceState =
    data?.voice_state;

  if (
    !voiceState
    || typeof voiceState
      !== "object"
  ) {
    return {
      muted:
        undefined,

      deafened:
        undefined
    };
  }

  /*
   * A user should be considered muted if Discord
   * reports either a server mute, self mute, or
   * suppression.
   *
   * The top-level data.mute field is intentionally
   * not used here. It can represent local voice
   * handling rather than the remote user's own
   * mute state.
   */
  const muted =
    Boolean(
      voiceState.mute
      || voiceState.self_mute
      || voiceState.suppress
    );

  const deafened =
    Boolean(
      voiceState.deaf
      || voiceState.self_deaf
    );

  return {
    muted,
    deafened
  };
}


function translateRpcEvent(
  payload,
  overlayIds
) {
  if (
    !payload
    || typeof payload
      !== "object"
  ) {
    return null;
  }

  const eventName =
    payload.evt;

  if (
    typeof eventName
      !== "string"
    || !RECOGNIZED_RPC_EVENTS
      .has(eventName)
  ) {
    return null;
  }

  const data =
    payload.data;

  if (
    !data
    || typeof data
      !== "object"
  ) {
    return null;
  }


  if (
    eventName
      === RPC_EVENTS.SPEAKING_START
    || eventName
      === RPC_EVENTS.SPEAKING_STOP
  ) {
    const discordUserId =
      normalizeString(
        data.user_id
      );

    /*
     * Never coerce a numeric Discord snowflake.
     * If StreamKit changes and gives us a Number,
     * reject it rather than risk precision loss.
     */
    if (!discordUserId) {
      return {
        error: {
          code:
            "speaking-user-id-unavailable",

          message:
            `${eventName} did not contain a valid string Discord User ID.`
        }
      };
    }

    return {
      rawObservation: {
        type:
          "speaking",

        user: {
          id:
            discordUserId
        },

        voice: {
          channelId:
            normalizeString(
              data.channel_id
            )
            ?? overlayIds.channelId,

          guildId:
            overlayIds.guildId
        },

        speaking:
          eventName
            === RPC_EVENTS
              .SPEAKING_START
      }
    };
  }


  const user =
    data.user;

  const discordUserId =
    normalizeString(
      user?.id
    );

  if (!discordUserId) {
    return {
      error: {
        code:
          "voice-state-user-id-unavailable",

        message:
          `${eventName} did not contain a valid string Discord User ID.`
      }
    };
  }


  const voiceFlags =
    getVoiceFlags(
      data
    );


  const phase =
    eventName
      === RPC_EVENTS
        .VOICE_STATE_CREATE
      ? "create"

      : eventName
        === RPC_EVENTS
          .VOICE_STATE_UPDATE
        ? "update"

        : "delete";


  return {
    rawObservation: {
      type:
        "voice-state",

      phase,

      user: {
        id:
          discordUserId,

        username:
          normalizeString(
            user?.username
          ),

        nick:
          normalizeString(
            data.nick
          )
      },

      voice: {
        muted:
          voiceFlags.muted,

        deafened:
          voiceFlags.deafened,

        channelId:
          overlayIds.channelId,

        guildId:
          overlayIds.guildId
      }
    }
  };
}

// #endregion


// #region Console Source

export function createStreamKitConsoleSource({
  pageWindow =
    globalThis,

  onRawObservation,
  onError
} = {}) {
  const originalMethods =
    new Map();

  const wrappers =
    new Map();


  let installed =
    false;

  let recognizedCount =
    0;

  let errorCount =
    0;

  let lastEventName =
    null;

  let lastError =
    null;


  const overlayIds =
    parseOverlayIds(
      pageWindow.location
    );


  function reportError(
    code,
    message
  ) {
    errorCount += 1;

    lastError = {
      code,
      message,
      timestamp:
        Date.now()
    };

    onError?.({
      ...lastError
    });
  }


  function inspectArgument(arg) {
    const translated =
      translateRpcEvent(
        arg,
        overlayIds
      );

    if (!translated) {
      return;
    }


    if (translated.error) {
      reportError(
        translated.error.code,
        translated.error.message
      );

      return;
    }


    if (
      !translated.rawObservation
    ) {
      return;
    }


    recognizedCount += 1;

    lastEventName =
      arg.evt;

    onRawObservation?.(
      translated.rawObservation
    );
  }


  function start() {
    if (installed) {
      return true;
    }


    const pageConsole =
      pageWindow.console;

    if (!pageConsole) {
      reportError(
        "console-unavailable",
        "The StreamKit page console is unavailable."
      );

      return false;
    }


    for (
      const method
      of CONSOLE_METHODS
    ) {
      const original =
        pageConsole[method];

      if (
        typeof original
        !== "function"
      ) {
        continue;
      }


      originalMethods.set(
        method,
        original
      );


      const wrapper =
        function (
          ...args
        ) {
          /*
           * Preserve StreamKit's normal console behavior
           * first. Relay inspection must never prevent
           * Discord's own logging.
           */
          const result =
            original.apply(
              this,
              args
            );


          try {
            for (
              const arg
              of args
            ) {
              inspectArgument(
                arg
              );
            }
          } catch (error) {
            reportError(
              "console-event-inspection-failed",

              error instanceof Error
                ? error.message
                : String(error)
            );
          }


          return result;
        };


      wrappers.set(
        method,
        wrapper
      );

      pageConsole[method] =
        wrapper;
    }


    if (
      wrappers.size === 0
    ) {
      reportError(
        "console-interception-unavailable",
        "No StreamKit console methods could be intercepted."
      );

      return false;
    }


    installed =
      true;

    return true;
  }


  function stop() {
    if (!installed) {
      return;
    }


    const pageConsole =
      pageWindow.console;


    for (
      const [
        method,
        original
      ]
      of originalMethods.entries()
    ) {
      /*
       * Restore only if our wrapper still owns the
       * method. Do not overwrite a later page change.
       */
      if (
        pageConsole[method]
        === wrappers.get(method)
      ) {
        pageConsole[method] =
          original;
      }
    }


    installed =
      false;
  }


  function getState() {
    return {
      installed,

      strategy:
        "event-interception",

      recognizedCount,
      errorCount,
      lastEventName,

      overlayGuildId:
        overlayIds.guildId
        ?? null,

      overlayChannelId:
        overlayIds.channelId
        ?? null,

      lastError:
        lastError
          ? { ...lastError }
          : null
    };
  }


  return Object.freeze({
    start,
    stop,
    getState
  });
}

// #endregion