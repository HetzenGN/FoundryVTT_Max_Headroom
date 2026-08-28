// relay/src/streamkit-adapter.js

// #region Constants

export const EXTRACTION_STRATEGIES =
  Object.freeze({
    MOCK:
      "mock",

    EVENT_INTERCEPTION:
      "event-interception",

    DOM_OBSERVER:
      "dom-observer",

    UNAVAILABLE:
      "unavailable"
  });


const RAW_TYPES =
  Object.freeze({
    VOICE_STATE:
      "voice-state",

    SPEAKING:
      "speaking",

    MUTE:
      "mute",

    DEAFEN:
      "deafen"
  });

// #endregion


// #region Helpers

function normalizeOptionalText(value) {
  if (
    value === undefined
    || value === null
  ) {
    return undefined;
  }

  const text =
    String(value).trim();

  return text || undefined;
}


function normalizeUser(raw) {
  const id =
    raw?.user?.id;

  /*
   * Discord snowflakes must arrive as strings.
   *
   * Do not accept a JavaScript Number here because
   * precision may already have been lost before the
   * relay sees it.
   */
  if (
    typeof id !== "string"
    || !id.trim()
  ) {
    return null;
  }

  return {
    discordUserId:
      id.trim(),

    username:
      normalizeOptionalText(
        raw.user?.username
      ),

    nick:
      normalizeOptionalText(
        raw.user?.nick
      )
  };
}


function normalizeVoice(raw) {
  const voice =
    raw?.voice;

  return {
    muted:
      typeof voice?.muted
        === "boolean"
        ? voice.muted
        : undefined,

    deafened:
      typeof voice?.deafened
        === "boolean"
        ? voice.deafened
        : undefined,

    channelId:
      normalizeOptionalText(
        voice?.channelId
      ),

    guildId:
      normalizeOptionalText(
        voice?.guildId
      )
  };
}

// #endregion


// #region Adapter

export function createStreamKitAdapter({
  strategy =
    EXTRACTION_STRATEGIES.MOCK,

  onEvent,
  onError
} = {}) {
  let observedCount = 0;
  let emittedCount = 0;
  let errorCount = 0;
  let lastError = null;


  function reportError(
    code,
    message,
    details
  ) {
    errorCount += 1;

    lastError = {
      code,
      message,

      details:
        details
        ?? undefined,

      timestamp:
        Date.now()
    };

    onError?.({
      ...lastError
    });

    return false;
  }


  function emit(event) {
    emittedCount += 1;

    onEvent?.(event);

    return true;
  }


  /**
   * Development raw-observation entrypoint.
   *
   * Fake inputs deliberately enter here instead of
   * bypassing the adapter and directly constructing
   * protocol messages.
   */
  function ingestRawObservation(raw) {
    observedCount += 1;

    if (
      !raw
      || typeof raw !== "object"
    ) {
      return reportError(
        "raw-observation-invalid",
        "Raw StreamKit observation is not an object."
      );
    }

    const user =
      normalizeUser(raw);

    if (!user) {
      return reportError(
        "discord-user-id-unavailable",
        "Raw StreamKit observation does not contain a valid string Discord User ID."
      );
    }

    const voice =
      normalizeVoice(raw);

    const base = {
      ...user,
      ...voice
    };


    switch (raw.type) {
      case RAW_TYPES.VOICE_STATE:
        return emit({
          kind:
            "voice-state",

          phase:
            typeof raw.phase
              === "string"
              ? raw.phase
              : "snapshot",

          ...base
        });


      case RAW_TYPES.SPEAKING:
        if (
          typeof raw.speaking
          !== "boolean"
        ) {
          return reportError(
            "speaking-state-invalid",
            "Speaking observation does not contain a boolean speaking state."
          );
        }

        return emit({
          kind:
            "speaking",

          ...base,

          speaking:
            raw.speaking
        });


      case RAW_TYPES.MUTE:
        if (
          typeof raw.muted
          !== "boolean"
        ) {
          return reportError(
            "mute-state-invalid",
            "Mute observation does not contain a boolean muted state."
          );
        }

        return emit({
          kind:
            "mute",

          ...base,

          muted:
            raw.muted
        });


      case RAW_TYPES.DEAFEN:
        if (
          typeof raw.deafened
          !== "boolean"
        ) {
          return reportError(
            "deafen-state-invalid",
            "Deafen observation does not contain a boolean deafened state."
          );
        }

        return emit({
          kind:
            "deafen",

          ...base,

          deafened:
            raw.deafened
        });


      default:
        return reportError(
          "raw-observation-unknown",
          `Unknown raw StreamKit observation type: ${String(raw.type)}`
        );
    }
  }


  function getStrategy() {
    return strategy;
  }


  function getState() {
    return {
      strategy,
      observedCount,
      emittedCount,
      errorCount,

      lastError:
        lastError
          ? { ...lastError }
          : null
    };
  }


  return Object.freeze({
    ingestRawObservation,
    getStrategy,
    getState
  });
}

// #endregion