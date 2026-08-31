// shared/protocol.js

// #region Core Identity

export const MODULE_ID =
  "foundryvtt-max-headroom";

export const PROTOCOL_VERSION =
  1;

// #endregion


// #region Internal Relay Message Types

export const MESSAGE_TYPES =
  Object.freeze({
    DISCORD_SPEAKING:
      "discord-speaking"
  });

// #endregion


// #region Foundry Socket Protocol

export const SOCKET_CHANNEL =
  `module.${MODULE_ID}`;

export const SOCKET_EVENTS =
  Object.freeze({
    SPEAKING_UPDATE:
      "speaking-update",

    FULLSYNC_REQUEST:
      "fullsync-request",

    FULLSYNC_RESPONSE:
      "fullsync-response",

    RESET_SPEAKING:
      "reset-speaking"
  });

// #endregion


// #region User Flags

export const FLAG_KEYS =
  Object.freeze({
    ROOT:
      MODULE_ID,

    DISCORD_USER_ID:
      "discordUserId",

    IDLE_IMAGE:
      "idleImage",

    TALKING_IMAGE:
      "talkingImage",

    MUTED_IMAGE:
      "mutedImage",

    ENABLED:
      "enabled",

    SORT_ORDER:
      "sortOrder"
  });

// #endregion


// #region Time Helpers

export function nowTs() {
  return Date.now();
}

// #endregion


// #region Discord Speaking Records

/**
 * Create the module's normalized internal
 * Discord-speaking record.
 *
 * This is no longer an external transport envelope.
 * Chromium-extension validation occurs before this
 * record is created.
 */
export function makeDiscordSpeaking({
  discordUserId,
  username,
  nick,
  speaking,
  muted = false,
  deafened = false,
  channelId,
  guildId,
  timestamp = nowTs()
} = {}) {
  return {
    type:
      MESSAGE_TYPES.DISCORD_SPEAKING,

    version:
      PROTOCOL_VERSION,

    discordUserId:
      String(
        discordUserId
        ?? ""
      ),

    username,
    nick,

    speaking:
      Boolean(speaking),

    muted:
      Boolean(muted),

    deafened:
      Boolean(deafened),

    channelId,
    guildId,
    timestamp
  };
}


/**
 * Return whether a value has the common
 * internal protocol envelope.
 */
export function isProtocolMessage(
  payload
) {
  return Boolean(
    payload
    && typeof payload === "object"
    && typeof payload.type === "string"
    && payload.version
      === PROTOCOL_VERSION
  );
}


/**
 * Validate one internal Discord-speaking record.
 */
export function isDiscordSpeakingMessage(
  payload
) {
  return Boolean(
    isProtocolMessage(
      payload
    )

    && payload.type
      === MESSAGE_TYPES.DISCORD_SPEAKING

    && typeof payload.discordUserId
      === "string"

    && payload.discordUserId.length > 0

    && typeof payload.speaking
      === "boolean"

    && typeof payload.timestamp
      === "number"
  );
}


/**
 * Normalize one internal Discord-speaking record.
 */
export function normalizeDiscordSpeakingMessage(
  payload
) {
  if (!payload) {
    return null;
  }


  const normalized = {
    type:
      payload.type,

    version:
      payload.version,

    discordUserId:
      payload.discordUserId
        ? String(
            payload.discordUserId
          )
        : "",

    username:
      payload.username
      ?? undefined,

    nick:
      payload.nick
      ?? undefined,

    speaking:
      Boolean(
        payload.speaking
      ),

    muted:
      Boolean(
        payload.muted
      ),

    deafened:
      Boolean(
        payload.deafened
      ),

    channelId:
      payload.channelId
      ?? undefined,

    guildId:
      payload.guildId
      ?? undefined,

    timestamp:
      Number(
        payload.timestamp
        ?? nowTs()
      )
  };


  return isDiscordSpeakingMessage(
    normalized
  )
    ? normalized
    : null;
}

// #endregion