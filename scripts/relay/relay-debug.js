// scripts/relay/relay-debug.js

// #region Imports

import {
  PROTOCOL_VERSION,
  nowTs
} from "../../shared/protocol.js";

import {
  getSetting,
  SETTING_KEYS
} from "../settings.js";

import {
  getReactivePortraitConfig
} from "../portraits/portrait-flags.js";

import {
  portraitState
} from "../portraits/portrait-state.js";

import {
  relayController
} from "./relay-controller.js";

import {
  relayState
} from "./relay-state.js";

import {
  socketService
} from "./socket-service.js";

// #endregion


// #region Constants

const LOG_PREFIX =
  "[FoundryVTT_Max_Headroom]";

const DEBUG_EXTENSION_VERSION =
  "0.2.72-debug";

const DEBUG_CHANNEL_ID =
  "999999999999999998";

const DEBUG_GUILD_ID =
  "999999999999999997";

const DEBUG_UNMAPPED_USER_ID =
  "999999999999999999";

// #endregion


// #region Internal Helpers

function requireLocalRelayHost() {
  if (!game.user?.isGM) {
    throw new Error(
      `${LOG_PREFIX} Relay debug tools are GM-only.`
    );
  }


  if (
    !relayController.isLocalHost()
  ) {
    throw new Error(
      `${LOG_PREFIX} Claim Relay Host before running relay integration tests.`
    );
  }
}


/**
 * Resolve a Foundry User by document, ID,
 * or exact case-insensitive name.
 */
function resolveFoundryUser(
  userReference
) {
  if (!userReference) {
    return null;
  }


  if (
    typeof userReference
      === "object"

    && userReference.id

    && typeof userReference.getFlag
      === "function"
  ) {
    return userReference;
  }


  const value =
    String(
      userReference
    ).trim();


  if (!value) {
    return null;
  }


  const byId =
    game.users.get(
      value
    );


  if (byId) {
    return byId;
  }


  const lowered =
    value.toLowerCase();


  return (
    game.users.find(
      (user) =>
        String(
          user.name
          ?? ""
        )
          .toLowerCase()
        === lowered
    )

    ?? null
  );
}


/**
 * Resolve either a configured Foundry User or
 * a direct Discord snowflake.
 */
function resolveDiscordUserId(
  reference
) {
  const user =
    resolveFoundryUser(
      reference
    );


  if (user) {
    const config =
      getReactivePortraitConfig(
        user
      );


    if (
      !config.discordUserId
    ) {
      throw new Error(
        `${LOG_PREFIX} Foundry User "${user.name}" has no configured Discord User ID.`
      );
    }


    return String(
      config.discordUserId
    );
  }


  const value =
    String(
      reference
      ?? ""
    ).trim();


  if (!value) {
    throw new Error(
      `${LOG_PREFIX} A Discord User ID or configured Foundry User is required.`
    );
  }


  return value;
}


/**
 * Prefer the actual currently-known StreamKit
 * channel so debug events resemble live events.
 */
function getDebugChannelId() {
  const channelId =
    String(
      relayController
        .getStatus()
        .extensionChannelId
      ?? ""
    ).trim();


  return /^\d+$/.test(
    channelId
  )
    ? channelId
    : DEBUG_CHANNEL_ID;
}


function getCurrentDiscordState(
  discordUserId
) {
  return (
    relayState.getSpeakingState(
      discordUserId
    )

    ?? {
      discordUserId,
      speaking:
        false
    }
  );
}


function getLastRejectedMessage() {
  return (
    relayController
      .getStatus()
      .lastRejectedMessage
    ?? null
  );
}

// #endregion


// #region Extension Health Simulation

/**
 * Simulate a valid extension READY event.
 */
export function simulateRelayReady({
  extensionVersion =
    DEBUG_EXTENSION_VERSION,

  channelId =
    getDebugChannelId()
} = {}) {
  requireLocalRelayHost();


  relayController
    .receiveExtensionRelayHealth({
      state:
        "ready",

      channelId:
        String(channelId),

      extensionVersion:
        String(extensionVersion),

      observedAt:
        nowTs()
    });


  return relayState
    .getRelayHealth();
}


/**
 * Simulate one valid extension heartbeat.
 */
export function simulateRelayHeartbeat({
  extensionVersion =
    DEBUG_EXTENSION_VERSION,

  channelId =
    getDebugChannelId()
} = {}) {
  requireLocalRelayHost();


  relayController
    .receiveExtensionRelayHealth({
      state:
        "heartbeat",

      channelId:
        String(channelId),

      extensionVersion:
        String(extensionVersion),

      observedAt:
        nowTs()
    });


  return relayState
    .getRelayHealth();
}


/**
 * Simulate extension/StreamKit disconnection.
 */
export function simulateRelayDisconnect({
  extensionVersion =
    DEBUG_EXTENSION_VERSION,

  channelId =
    getDebugChannelId()
} = {}) {
  requireLocalRelayHost();


  relayController
    .receiveExtensionRelayHealth({
      state:
        "disconnected",

      channelId:
        String(channelId),

      extensionVersion:
        String(extensionVersion),

      observedAt:
        nowTs()
    });


  return relayState
    .getRelayHealth();
}

// #endregion


// #region Speaking Simulation

/**
 * Simulate the same small speaking envelope
 * delivered by the Chromium extension.
 */
export function simulateRelaySpeaking(
  reference,
  speaking = true,
  {
    channelId =
      getDebugChannelId(),

    timestamp =
      nowTs()
  } = {}
) {
  requireLocalRelayHost();


  const discordUserId =
    resolveDiscordUserId(
      reference
    );


  const normalizedSpeaking =
    Boolean(
      speaking
    );


  relayController
    .receiveExtensionSpeakingEvent({
      eventName:
        normalizedSpeaking
          ? "SPEAKING_START"
          : "SPEAKING_STOP",

      discordUserId,

      channelId:
        String(channelId),

      speaking:
        normalizedSpeaking,

      observedAt:
        Number(timestamp)
    });


  return relayState
    .getSpeakingState(
      discordUserId
    );
}


/**
 * Toggle one configured Discord user's
 * speaking state.
 */
export function toggleRelaySpeaking(
  reference
) {
  const discordUserId =
    resolveDiscordUserId(
      reference
    );


  const current =
    getCurrentDiscordState(
      discordUserId
    );


  return simulateRelaySpeaking(
    discordUserId,
    !current.speaking
  );
}


/**
 * Simulate several simultaneous speakers.
 */
export function simulateRelaySimultaneousSpeakers(
  references = []
) {
  if (
    !Array.isArray(
      references
    )
  ) {
    throw new TypeError(
      `${LOG_PREFIX} simulateRelaySimultaneousSpeakers requires an array.`
    );
  }


  return references.map(
    (reference) =>
      simulateRelaySpeaking(
        reference,
        true
      )
  );
}

// #endregion


// #region Discord User Discovery Simulation

/**
 * Simulate Discord voice-state discovery.
 *
 * This exercises the same Foundry ingress used
 * by the extension's VOICE_STATE_* events.
 */
export function simulateDiscordUserPresence(
  reference,
  present = true,
  {
    username,
    nick,

    muted = false,

    guildId =
      DEBUG_GUILD_ID,

    channelId =
      getDebugChannelId()
  } = {}
) {
  requireLocalRelayHost();


  const foundryUser =
    resolveFoundryUser(
      reference
    );


  const discordUserId =
    resolveDiscordUserId(
      reference
    );


  const normalizedPresent =
    Boolean(
      present
    );


  return relayController
    .receiveExtensionDiscordUserEvent({
      eventName:
        normalizedPresent
          ? "VOICE_STATE_UPDATE"
          : "VOICE_STATE_DELETE",

      discordUserId,

      username:
        username
        ?? foundryUser?.name
        ?? `Debug-${discordUserId}`,

      nick:
        nick
        ?? "",

      guildId:
        String(guildId),

      channelId:
        String(channelId),

      present:
        normalizedPresent,

      /*
       * A user who is no longer present in
       * voice cannot remain muted.
       */
      muted:
        normalizedPresent
          ? Boolean(muted)
          : false,

      observedAt:
        nowTs()
    });
}

/**
 * Simulate one Discord user's mute/unmute
 * through the real extension voice-state ingress.
 */
export function simulateRelayMuted(
  reference,
  muted = true
) {
  requireLocalRelayHost();


  const foundryUser =
    resolveFoundryUser(
      reference
    );


  const discordUserId =
    resolveDiscordUserId(
      reference
    );


  const discovered =
    relayController
      .getDiscoveredDiscordUsers()
      .find(
        (entry) =>
          entry.discordUserId
          === discordUserId
      );


  return relayController
    .receiveExtensionDiscordUserEvent({
      eventName:
        "VOICE_STATE_UPDATE",

      discordUserId,

      username:
        discovered?.username
        ?? foundryUser?.name
        ?? `Debug-${discordUserId}`,

      nick:
        discovered?.nick
        ?? "",

      guildId:
        discovered?.guildId
        ?? DEBUG_GUILD_ID,

      channelId:
        discovered?.channelId
        ?? getDebugChannelId(),

      present:
        true,

      muted:
        Boolean(muted),

      observedAt:
        nowTs()
    });
}

/**
 * Simulate a friendly but unmapped Discord user.
 */
export function simulateUnmappedDiscordUser(
  discordUserId =
    DEBUG_UNMAPPED_USER_ID,
  {
    username =
      "UnmappedDebugUser",

    nick =
      "Unmapped Debug"
  } = {}
) {
  requireLocalRelayHost();


  const normalizedId =
    String(
      discordUserId
    );


  relayController
    .receiveExtensionDiscordUserEvent({
      eventName:
        "VOICE_STATE_UPDATE",

      discordUserId:
        normalizedId,

      username,
      nick,

      guildId:
        DEBUG_GUILD_ID,

      channelId:
        getDebugChannelId(),

      present:
        true,

      muted:
        alse,

      observedAt:
        nowTs()
    });


  return simulateRelaySpeaking(
    normalizedId,
    true
  );
}

// #endregion


// #region Extension Validation Simulation

/**
 * Send a malformed extension speaking envelope.
 */
export function simulateInvalidSpeakingEvent(
  reference
) {
  requireLocalRelayHost();


  const discordUserId =
    resolveDiscordUserId(
      reference
    );


  relayController
    .receiveExtensionSpeakingEvent({
      eventName:
        "SPEAKING_STOP",

      discordUserId,

      channelId:
        getDebugChannelId(),

      /*
       * Deliberately inconsistent with
       * SPEAKING_STOP.
       */
      speaking:
        true,

      observedAt:
        nowTs()
    });


  return getLastRejectedMessage();
}


/**
 * Send an invalid Discord-user discovery envelope.
 */
export function simulateInvalidDiscordUserEvent(
  reference
) {
  requireLocalRelayHost();


  const discordUserId =
    resolveDiscordUserId(
      reference
    );


  relayController
    .receiveExtensionDiscordUserEvent({
      eventName:
        "VOICE_STATE_UPDATE",

      discordUserId,

      username:
        "Invalid Debug User",

      nick:
        "",

      guildId:
        DEBUG_GUILD_ID,

      channelId:
        getDebugChannelId(),

      /*
       * Deliberately inconsistent with
       * VOICE_STATE_UPDATE.
       */
      present:
        false,

      muted:
        false,

      observedAt:
        nowTs()
    });


  return getLastRejectedMessage();
}


/**
 * Send an invalid extension health envelope.
 */
export function simulateInvalidRelayHealth() {
  requireLocalRelayHost();


  relayController
    .receiveExtensionRelayHealth({
      state:
        "invalid-debug-state",

      channelId:
        getDebugChannelId(),

      extensionVersion:
        DEBUG_EXTENSION_VERSION,

      observedAt:
        nowTs()
    });


  return getLastRejectedMessage();
}

// #endregion


// #region Stale State Simulation

/**
 * Simulate a speaking record old enough for
 * stale-speaker cleanup.
 */
export function simulateStaleSpeaker(
  reference
) {
  requireLocalRelayHost();


  const timeout =
    Number(
      getSetting(
        SETTING_KEYS
          .STALE_SPEAKER_TIMEOUT_MS
      )
    );


  if (
    !Number.isFinite(
      timeout
    )
    || timeout <= 0
  ) {
    throw new Error(
      `${LOG_PREFIX} Stale Speaker Timeout is invalid.`
    );
  }


  /*
   * Extension ingress rejects events older than
   * sixty seconds, so the deterministic test must
   * remain inside that transport freshness window.
   */
  if (
    timeout >= 59000
  ) {
    throw new Error(
      `${LOG_PREFIX} For this deterministic debug test, set Stale Speaker Timeout below 59000 ms.`
    );
  }


  const discordUserId =
    resolveDiscordUserId(
      reference
    );


  simulateRelaySpeaking(
    discordUserId,
    true,
    {
      timestamp:
        nowTs()
        - timeout
        - 100
    }
  );


  const beforeWatchdog =
    relayState.getSpeakingState(
      discordUserId
    );


  relayState
    .runWatchdogNow();


  return {
    beforeWatchdog,

    afterWatchdog:
      relayState.getSpeakingState(
        discordUserId
      )
  };
}


/**
 * Deterministically exercise relay-health stale
 * detection without relying on browser timers.
 *
 * This is intentionally a RelayState unit-style
 * test because the real extension ingress rejects
 * timestamps older than its freshness window.
 */
export function simulateStaleRelay() {
  requireLocalRelayHost();


  relayState.recordHeartbeat({
    protocolVersion:
      PROTOCOL_VERSION,

    scriptVersion:
      "Chromium Extension debug",

    timestamp:
      nowTs()
      - 2000,

    heartbeatTimeoutMs:
      1000
  });


  relayState
    .runWatchdogNow();


  return relayState
    .getRelayHealth();
}

// #endregion


// #region Reset Utilities

export function resetRelaySpeaking() {
  requireLocalRelayHost();


  const changed =
    relayState
      .resetSpeakingStates(
        "debug-reset"
      );


  socketService
    .broadcastResetSpeaking();


  return changed;
}


export function clearRelaySpeakingStates() {
  requireLocalRelayHost();


  relayState
    .clearSpeakingStates();


  return relayState
    .getSpeakingStates();
}

// #endregion


// #region Diagnostics

export function getRelayDebugState() {
  return {
    controller:
      relayController.getStatus(),

    relayHealth:
      relayState.getRelayHealth(),

    discoveredDiscordUsers:
      relayController
        .getDiscoveredDiscordUsers(),

    authoritativeSpeaking:
      relayState
        .getSpeakingStates(),

    unmappedUsers:
      relayState
        .getUnmappedUsers(),

    socket:
      socketService.getStatus(),

    portraitState:
      portraitState.toObject()
  };
}

// #endregion


// #region Public Debug API

export const relayDebugApi =
  Object.freeze({
    simulateRelayReady,
    simulateRelayHeartbeat,
    simulateRelayDisconnect,

    simulateRelaySpeaking,
    toggleRelaySpeaking,
    simulateRelaySimultaneousSpeakers,

    simulateDiscordUserPresence,
    simulateUnmappedDiscordUser,

    simulateInvalidSpeakingEvent,
    simulateInvalidDiscordUserEvent,
    simulateInvalidRelayHealth,

    simulateStaleSpeaker,
    simulateStaleRelay,

    simulateDiscordUserPresence,
    simulateRelayMuted,
    simulateUnmappedDiscordUser,

    resetRelaySpeaking,
    clearRelaySpeakingStates,

    getRelayDebugState
  });

// #endregion