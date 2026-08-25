// scripts/relay/relay-debug.js

// #region Imports

import {
  MODULE_ID,
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  MESSAGE_SOURCES,
  nowTs,
  makeRelayReady,
  makeRelayHeartbeat,
  makeDiscordSpeaking
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

const DEBUG_SCRIPT_VERSION =
  "internal-debug";

// #endregion


// #region Internal Helpers

/**
 * Relay integration tests require the current browser to be the
 * authoritative GM relay host.
 */
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
 * Return the current relay session nonce.
 */
function getNonce() {
  const nonce =
    relayController.getNonce();

  if (!nonce) {
    throw new Error(
      `${LOG_PREFIX} The active relay host has no session nonce.`
    );
  }

  return nonce;
}


/**
 * Resolve a Foundry User from:
 *
 * - User document
 * - User ID
 * - exact User name
 */
function resolveFoundryUser(
  userReference
) {
  if (!userReference) {
    return null;
  }

  if (
    typeof userReference === "object"
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
    game.users.get(value);

  if (byId) {
    return byId;
  }

  const lowered =
    value.toLowerCase();

  return (
    game.users.find(
      (user) =>
        String(user.name ?? "")
          .toLowerCase()
        === lowered
    )
    ?? null
  );
}


/**
 * Resolve a useful test reference into a Discord User ID.
 *
 * A direct numeric/string Discord ID may be supplied.
 *
 * A configured Foundry User ID/name/document may also be supplied.
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

    if (!config.discordUserId) {
      throw new Error(
        `${LOG_PREFIX} Foundry User "${user.name}" has no configured Discord User ID.`
      );
    }

    return config.discordUserId;
  }

  const value =
    String(
      reference ?? ""
    ).trim();

  if (!value) {
    throw new Error(
      `${LOG_PREFIX} A Discord User ID or configured Foundry User is required.`
    );
  }

  return value;
}


/**
 * Inject one normal synthetic StreamKit message.
 */
function inject(payload) {
  requireLocalRelayHost();

  return relayController
    .injectDebugWindowMessage(
      payload
    );
}


/**
 * Read current authoritative state when constructing partial simulated
 * updates such as mute/deafen changes.
 */
function getCurrentDiscordState(
  discordUserId
) {
  return (
    relayState.getSpeakingState(
      discordUserId
    )
    ?? {
      discordUserId,
      speaking: false,
      muted: false,
      deafened: false
    }
  );
}

// #endregion


// #region Relay Lifecycle Simulation

/**
 * Simulate the external relay announcing that it is ready.
 */
export function simulateRelayReady({
  scriptVersion =
    DEBUG_SCRIPT_VERSION
} = {}) {
  const payload =
    makeRelayReady({
      nonce:
        getNonce(),

      source:
        MESSAGE_SOURCES.STREAMKIT,

      timestamp:
        nowTs()
    });

  payload.scriptVersion =
    scriptVersion;

  inject(payload);

  return relayState.getRelayHealth();
}


/**
 * Simulate a valid StreamKit heartbeat.
 */
export function simulateRelayHeartbeat({
  scriptVersion =
    DEBUG_SCRIPT_VERSION,

  timestamp =
    nowTs()
} = {}) {
  const payload =
    makeRelayHeartbeat({
      nonce:
        getNonce(),

      source:
        MESSAGE_SOURCES.STREAMKIT,

      timestamp
    });

  payload.scriptVersion =
    scriptVersion;

  inject(payload);

  return relayState.getRelayHealth();
}


/**
 * Simulate relay disconnection.
 *
 * A disconnect is a browser/popup lifecycle condition rather than an
 * incoming StreamKit protocol message, so this intentionally updates
 * RelayStateStore directly.
 */
export function simulateRelayDisconnect() {
  requireLocalRelayHost();

  relayState.markDisconnected();

  return relayState.getRelayHealth();
}


/**
 * Simulate an external relay error message.
 */
export function simulateRelayError(
  message =
    "Simulated relay error."
) {
  const payload = {
    type:
      MESSAGE_TYPES.RELAY_ERROR,

    version:
      PROTOCOL_VERSION,

    nonce:
      getNonce(),

    timestamp:
      nowTs(),

    source:
      MESSAGE_SOURCES.STREAMKIT,

    message:
      String(message)
  };

  inject(payload);

  return relayState.getRelayHealth();
}

// #endregion


// #region Discord Speaking Simulation

/**
 * Simulate a Discord speaking event.
 *
 * reference may be:
 *
 * - Discord User ID
 * - configured Foundry User ID
 * - configured Foundry User name
 * - Foundry User document
 */
export function simulateRelaySpeaking(
  reference,
  speaking = true,
  {
    username,
    nick,
    muted,
    deafened,
    channelId = "debug-channel",
    guildId = "debug-guild",
    timestamp = nowTs()
  } = {}
) {
  const discordUserId =
    resolveDiscordUserId(
      reference
    );

  const current =
    getCurrentDiscordState(
      discordUserId
    );

  const payload =
    makeDiscordSpeaking({
      nonce:
        getNonce(),

      discordUserId,

      username:
        username
        ?? current.username
        ?? `Debug-${discordUserId}`,

      nick:
        nick
        ?? current.nick,

      speaking:
        Boolean(speaking),

      muted:
        muted
        ?? current.muted
        ?? false,

      deafened:
        deafened
        ?? current.deafened
        ?? false,

      channelId:
        channelId
        ?? current.channelId,

      guildId:
        guildId
        ?? current.guildId,

      timestamp,

      source:
        MESSAGE_SOURCES.STREAMKIT
    });

  inject(payload);

  return relayState.getSpeakingState(
    discordUserId
  );
}


/**
 * Toggle the authoritative speaking state for one Discord mapping.
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
 * Simulate several simultaneous Discord speakers.
 */
export function simulateRelaySimultaneousSpeakers(
  references = []
) {
  if (
    !Array.isArray(references)
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


// #region Mute and Deafen Simulation

/**
 * Set one Discord user's muted state while preserving speaking/deafen state.
 */
export function simulateRelayMuted(
  reference,
  muted = true
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
    current.speaking,
    {
      username:
        current.username,

      nick:
        current.nick,

      muted:
        Boolean(muted),

      deafened:
        current.deafened,

      channelId:
        current.channelId,

      guildId:
        current.guildId
    }
  );
}


/**
 * Set one Discord user's deafened state while preserving speaking/mute state.
 */
export function simulateRelayDeafened(
  reference,
  deafened = true
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
    current.speaking,
    {
      username:
        current.username,

      nick:
        current.nick,

      muted:
        current.muted,

      deafened:
        Boolean(deafened),

      channelId:
        current.channelId,

      guildId:
        current.guildId
    }
  );
}

// #endregion


// #region Unmapped User Simulation

/**
 * Send a valid speaking event for a Discord User ID which is not expected
 * to map to any configured Foundry User.
 */
export function simulateUnmappedDiscordUser(
  discordUserId =
    "999999999999999999",
  {
    username =
      "UnmappedDebugUser",

    nick =
      "Unmapped Debug"
  } = {}
) {
  return simulateRelaySpeaking(
    String(discordUserId),
    true,
    {
      username,
      nick
    }
  );
}

// #endregion


// #region Validation Failure Simulation

/**
 * Send an otherwise-valid speaking event with an invalid nonce.
 */
export function simulateInvalidNonce(
  reference
) {
  const discordUserId =
    resolveDiscordUserId(
      reference
    );

  const payload =
    makeDiscordSpeaking({
      nonce:
        "invalid-debug-nonce",

      discordUserId,

      username:
        "InvalidNonceDebug",

      speaking:
        true,

      timestamp:
        nowTs(),

      source:
        MESSAGE_SOURCES.STREAMKIT
    });

  relayController
    .injectDebugWindowMessage(
      payload
    );

  return relayController.getStatus()
    .lastRejectedMessage;
}


/**
 * Send an otherwise-valid heartbeat from an unauthorized browser origin.
 */
export function simulateInvalidOrigin() {
  const payload =
    makeRelayHeartbeat({
      nonce:
        getNonce(),

      source:
        MESSAGE_SOURCES.STREAMKIT,

      timestamp:
        nowTs()
    });

  relayController
    .injectDebugWindowMessage(
      payload,
      {
        origin:
          "https://invalid.example"
      }
    );

  return relayController.getStatus()
    .lastRejectedMessage;
}


/**
 * Simulate a message from the wrong browser Window object.
 *
 * This is particularly useful when an actual relay popup is open.
 */
export function simulateInvalidWindowSource() {
  const payload =
    makeRelayHeartbeat({
      nonce:
        getNonce(),

      source:
        MESSAGE_SOURCES.STREAMKIT,

      timestamp:
        nowTs()
    });

  relayController
    .injectDebugWindowMessage(
      payload,
      {
        invalidSource: true
      }
    );

  return relayController.getStatus()
    .lastRejectedMessage;
}


/**
 * Simulate an incompatible protocol message.
 */
export function simulateInvalidProtocolVersion() {
  const payload =
    makeRelayHeartbeat({
      nonce:
        getNonce(),

      source:
        MESSAGE_SOURCES.STREAMKIT,

      timestamp:
        nowTs()
    });

  payload.version =
    PROTOCOL_VERSION + 1;

  relayController
    .injectDebugWindowMessage(
      payload
    );

  return relayController.getStatus()
    .lastRejectedMessage;
}

// #endregion


// #region Stale State Simulation

/**
 * Simulate a currently-speaking Discord user whose last authoritative
 * update is old enough to trigger stale-speaker cleanup.
 *
 * Uses the real controller -> relay state path, then explicitly runs one
 * watchdog pass so the test is deterministic.
 */
export function simulateStaleSpeaker(
  reference
) {
  const timeout =
    Number(
      getSetting(
        SETTING_KEYS.STALE_SPEAKER_TIMEOUT_MS
      )
    );

  if (
    !Number.isFinite(timeout)
    || timeout <= 0
  ) {
    throw new Error(
      `${LOG_PREFIX} Stale Speaker Timeout is invalid.`
    );
  }

  /*
   * RelayController rejects messages older than 60 seconds. The normal
   * default stale-speaker timeout is well below that.
   */
  if (timeout >= 59000) {
    throw new Error(
      `${LOG_PREFIX} For this deterministic debug test, set Stale Speaker Timeout below 59000 ms.`
    );
  }

  const state =
    simulateRelaySpeaking(
      reference,
      true,
      {
        timestamp:
          nowTs()
          - timeout
          - 100
      }
    );

  relayState.runWatchdogNow();

  return {
    beforeWatchdog:
      state,

    afterWatchdog:
      relayState.getSpeakingState(
        resolveDiscordUserId(
          reference
        )
      )
  };
}


/**
 * Simulate a relay heartbeat old enough for the relay-health watchdog to
 * mark the connection stale.
 */
export function simulateStaleRelay() {
  const timeout =
    Number(
      getSetting(
        SETTING_KEYS.RELAY_HEARTBEAT_TIMEOUT_MS
      )
    );

  if (
    !Number.isFinite(timeout)
    || timeout <= 0
  ) {
    throw new Error(
      `${LOG_PREFIX} Relay Heartbeat Timeout is invalid.`
    );
  }

  if (timeout >= 59000) {
    throw new Error(
      `${LOG_PREFIX} For this deterministic debug test, set Relay Heartbeat Timeout below 59000 ms.`
    );
  }

  simulateRelayHeartbeat({
    timestamp:
      nowTs()
      - timeout
      - 100
  });

  relayState.runWatchdogNow();

  return relayState.getRelayHealth();
}

// #endregion


// #region Reset Utilities

/**
 * Reset authoritative speaking state through the relay/socket layer.
 */
export function resetRelaySpeaking() {
  requireLocalRelayHost();

  const changed =
    relayState.resetSpeakingStates(
      "debug-reset"
    );

  socketService.broadcastResetSpeaking();

  return changed;
}


/**
 * Clear authoritative relay speaking records completely.
 */
export function clearRelaySpeakingStates() {
  requireLocalRelayHost();

  relayState.clearSpeakingStates();

  return relayState.getSpeakingStates();
}

// #endregion


// #region Diagnostics

/**
 * Return a combined integration-test snapshot.
 */
export function getRelayDebugState() {
  return {
    controller:
      relayController.getStatus(),

    relayHealth:
      relayState.getRelayHealth(),

    authoritativeSpeaking:
      relayState.getSpeakingStates(),

    unmappedUsers:
      relayState.getUnmappedUsers(),

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
    simulateRelayError,

    simulateRelaySpeaking,
    toggleRelaySpeaking,
    simulateRelaySimultaneousSpeakers,

    simulateRelayMuted,
    simulateRelayDeafened,

    simulateUnmappedDiscordUser,

    simulateInvalidNonce,
    simulateInvalidOrigin,
    simulateInvalidWindowSource,
    simulateInvalidProtocolVersion,

    simulateStaleSpeaker,
    simulateStaleRelay,

    resetRelaySpeaking,
    clearRelaySpeakingStates,

    getRelayDebugState
  });

// #endregion