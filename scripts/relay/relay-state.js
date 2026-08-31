// scripts/relay/relay-state.js

// #region Imports

import {
  MODULE_ID,
  PROTOCOL_VERSION,
  nowTs
} from "../../shared/protocol.js";

import {
  getSetting,
  SETTING_KEYS
} from "../settings.js";

// #endregion


// #region Constants

const LOG_PREFIX = "[FoundryVTT_Max_Headroom]";

/**
 * Relay connection/health states.
 */
export const RELAY_STATUS = Object.freeze({
  DISCONNECTED: "disconnected",
  CONNECTED: "connected",
  STALE: "stale",
  INCOMPATIBLE: "incompatible",
  ERROR: "error"
});

/**
 * RelayStateStore subscription event types.
 */
export const RELAY_STATE_EVENTS = Object.freeze({
  RELAY_STATUS: "relay-status",
  SPEAKING_UPDATE: "speaking-update",
  RESET_SPEAKING: "reset-speaking",
  FULL_STATE: "full-state",
  UNMAPPED_UPDATE: "unmapped-update"
});

/**
 * How frequently the watchdog checks relay and speaker freshness.
 *
 * This is intentionally much shorter than the configured stale thresholds
 * while remaining inexpensive.
 */
const WATCHDOG_INTERVAL_MS = 500;

const DEFAULT_RELAY_HEARTBEAT_TIMEOUT_MS = 90000;

// #endregion


// #region Internal Helpers

/**
 * Normalize a Discord User ID.
 *
 * Discord snowflakes must remain strings.
 */
function normalizeDiscordUserId(value) {
  if (
    value === null
    || value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}

/**
 * Normalize a Discord speaking-state record.
 */
function normalizeSpeakingState(state = {}) {
  return {
    discordUserId:
      normalizeDiscordUserId(
        state.discordUserId
      ),

    username:
      state.username
      ?? undefined,

    nick:
      state.nick
      ?? undefined,

    speaking:
      Boolean(state.speaking),

    muted:
      Boolean(state.muted),

    deafened:
      Boolean(state.deafened),

    channelId:
      state.channelId
      ?? undefined,

    guildId:
      state.guildId
      ?? undefined,

    updatedAt:
      Number.isFinite(
        Number(state.updatedAt)
      )
        ? Number(state.updatedAt)
        : nowTs()
  };
}

/**
 * Return the configured stale-speaker timeout.
 */
function getStaleSpeakerTimeoutMs() {
  const value = Number(
    getSetting(
      SETTING_KEYS.STALE_SPEAKER_TIMEOUT_MS
    )
  );

  if (!Number.isFinite(value)) {
    return 10000;
  }

  return Math.max(
    1000,
    value
  );
}

/**
 * Verify that authoritative relay mutations are being performed by a GM.
 */
function requireGM() {
  if (!game.user?.isGM) {
    throw new Error(
      `${LOG_PREFIX} Authoritative relay state may only be modified by a GM.`
    );
  }
}

function normalizeHeartbeatTimeout(
  value
) {
  const number =
    Number(value);


  if (!Number.isFinite(number)) {
    return null;
  }


  return Math.max(
    1000,
    number
  );
}

// #endregion


// #region Relay State Store

/**
 * GM-authoritative runtime relay state.
 *
 * This store owns:
 *
 * - relay connection/health information
 * - current Discord speaking state
 * - stale-speaker correction
 * - unmapped Discord-user diagnostics
 *
 * It does not:
 *
 * - render UI
 * - communicate directly with StreamKit
 * - communicate through Foundry sockets
 *
 * Those responsibilities belong to later layers.
 */
export class RelayStateStore {
  constructor() {
    // #region Relay Health State

    this._relayStatus =
      RELAY_STATUS.DISCONNECTED;

    this._lastHeartbeat = 0;
    this._lastValidDiscordEvent = 0;

    this._relayProtocolVersion = null;
    this._relayScriptVersion = null;
    this._heartbeatTimeoutOverrideMs =
      null;

    this._lastError = null;

    // #endregion

    // #region Speaking State

    /**
     * Map<discordUserId, speakingState>
     */
    this._speakingStates =
      new Map();

    /**
     * Diagnostic records for Discord users which do not currently map
     * to a Foundry User.
     *
     * Mapping determination will be performed by the relay controller.
     */
    this._unmappedUsers =
      new Map();

    // #endregion

    // #region Subscriptions and Watchdog

    this._listeners =
      new Set();

    this._watchdogTimer =
      null;

    // #endregion
  }

  // #region Relay Health Readers

  /**
   * Return the current relay connection status.
   */
  getRelayStatus() {
    return this._relayStatus;
  }

  /**
   * Return a snapshot of relay health information.
   */
  getRelayHealth() {
    return {
      status:
        this._relayStatus,

      lastHeartbeat:
        this._lastHeartbeat,

      heartbeatTimeoutMs:
        this._heartbeatTimeoutOverrideMs
        ?? DEFAULT_RELAY_HEARTBEAT_TIMEOUT_MS,

      lastValidDiscordEvent:
        this._lastValidDiscordEvent,

      relayProtocolVersion:
        this._relayProtocolVersion,

      relayScriptVersion:
        this._relayScriptVersion,

      lastError:
        this._lastError
    };
  }

  // #endregion


  // #region Relay Health Writers


  /**
   * Mark the relay as ready/connected.
   */
  markReady({
    protocolVersion = PROTOCOL_VERSION,
    scriptVersion,
    heartbeatTimeoutMs
  } = {}) {
    requireGM();


    this._relayProtocolVersion =
      protocolVersion;


    this._relayScriptVersion =
      scriptVersion
      ?? this._relayScriptVersion;


    this._heartbeatTimeoutOverrideMs =
      normalizeHeartbeatTimeout(
        heartbeatTimeoutMs
      );


    this._lastHeartbeat =
      nowTs();


    this._lastError =
      null;


    if (
      protocolVersion
      !== PROTOCOL_VERSION
    ) {
      this._setRelayStatus(
        RELAY_STATUS.INCOMPATIBLE
      );

      return this.getRelayHealth();
    }


    this._setRelayStatus(
      RELAY_STATUS.CONNECTED
    );


    return this.getRelayHealth();
  }

  /**
   * Record a valid relay heartbeat.
   */
  recordHeartbeat({
    protocolVersion = PROTOCOL_VERSION,
    scriptVersion,
    timestamp = nowTs(),
    heartbeatTimeoutMs
  } = {}) {
    requireGM();


    this._relayProtocolVersion =
      protocolVersion;


    this._relayScriptVersion =
      scriptVersion
      ?? this._relayScriptVersion;


    if (
      heartbeatTimeoutMs
      !== undefined
    ) {
      this._heartbeatTimeoutOverrideMs =
        normalizeHeartbeatTimeout(
          heartbeatTimeoutMs
        );
    }


    this._lastHeartbeat =
      Number(timestamp)
      || nowTs();


    if (
      protocolVersion
      !== PROTOCOL_VERSION
    ) {
      this._setRelayStatus(
        RELAY_STATUS.INCOMPATIBLE
      );

      return this.getRelayHealth();
    }


    this._lastError =
      null;


    this._setRelayStatus(
      RELAY_STATUS.CONNECTED
    );


    return this.getRelayHealth();
  }

  /**
   * Mark the relay disconnected.
   *
   * Existing user mappings and speaking-state records are retained.
   * The stale-speaker watchdog will safely clear any speaking=true records.
   */
  markDisconnected() {
    requireGM();


    this._heartbeatTimeoutOverrideMs =
      null;


    this._setRelayStatus(
      RELAY_STATUS.DISCONNECTED
    );
  }

  /**
   * Mark the relay incompatible with this protocol version.
   */
  markIncompatible(
    protocolVersion = null
  ) {
    requireGM();

    this._relayProtocolVersion =
      protocolVersion;

    this._setRelayStatus(
      RELAY_STATUS.INCOMPATIBLE
    );
  }

  /**
   * Record an external relay error.
   */
  markError(error) {
    requireGM();

    this._lastError =
      error instanceof Error
        ? error.message
        : String(error ?? "Unknown relay error");

    this._setRelayStatus(
      RELAY_STATUS.ERROR
    );
  }

  /**
   * Internal relay-status setter.
   */
  _setRelayStatus(status) {
    if (
      this._relayStatus
      === status
    ) {
      return;
    }

    this._relayStatus =
      status;

    this._emit({
      type:
        RELAY_STATE_EVENTS.RELAY_STATUS,

      health:
        this.getRelayHealth()
    });
  }

  // #endregion


  // #region Speaking State Readers

  /**
   * Return one Discord user's authoritative speaking state.
   */
  getSpeakingState(
    discordUserId
  ) {
    const id =
      normalizeDiscordUserId(
        discordUserId
      );

    if (!id) {
      return null;
    }

    const state =
      this._speakingStates.get(id);

    return state
      ? { ...state }
      : null;
  }

  /**
   * Return all authoritative Discord speaking states as a plain object.
   */
  getSpeakingStates() {
    return Object.fromEntries(
      Array.from(
        this._speakingStates.entries(),
        ([id, state]) => [
          id,
          { ...state }
        ]
      )
    );
  }

  /**
   * Return all users currently marked speaking.
   */
  getActiveSpeakers() {
    return Array.from(
      this._speakingStates.values()
    )
      .filter(
        (state) =>
          state.speaking
      )
      .map(
        (state) => ({
          ...state
        })
      );
  }

  // #endregion


  // #region Speaking State Writers

/**
 * Apply one normalized authoritative Discord speaking update.
 *
 * This expects the Relay Controller to have already
 * validated and normalized the companion-extension
 * speaking envelope.
 */
  updateSpeakingState(
    update
  ) {
    requireGM();

    const state =
      normalizeSpeakingState({
        ...update,

        updatedAt:
          update?.timestamp
          ?? update?.updatedAt
          ?? nowTs()
      });

    if (!state.discordUserId) {
      throw new TypeError(
        `${LOG_PREFIX} Discord speaking update is missing discordUserId.`
      );
    }

    this._speakingStates.set(
      state.discordUserId,
      state
    );

    this._lastValidDiscordEvent =
      state.updatedAt;

    this._emit({
      type:
        RELAY_STATE_EVENTS.SPEAKING_UPDATE,

      reason:
        "relay-event",

      state: {
        ...state
      }
    });

    return {
      ...state
    };
  }

  /**
   * Reset every Discord user to speaking=false.
   *
   * Mute and deafen states are preserved.
   */
  resetSpeakingStates(
    reason = "manual-reset"
  ) {
    requireGM();

    const changed = [];

    for (
      const [discordUserId, state]
      of this._speakingStates.entries()
    ) {
      if (!state.speaking) {
        continue;
      }

      const nextState = {
        ...state,
        speaking: false,
        updatedAt: nowTs()
      };

      this._speakingStates.set(
        discordUserId,
        nextState
      );

      changed.push({
        ...nextState
      });

      this._emit({
        type:
          RELAY_STATE_EVENTS.SPEAKING_UPDATE,

        reason,

        state: {
          ...nextState
        }
      });
    }

    this._emit({
      type:
        RELAY_STATE_EVENTS.RESET_SPEAKING,

      reason,

      states:
        changed
    });

    return changed;
  }

  /**
   * Completely clear authoritative Discord speaking records.
   *
   * Primarily useful for development/reset scenarios.
   */
  clearSpeakingStates() {
    requireGM();

    this._speakingStates.clear();

    this._emit({
      type:
        RELAY_STATE_EVENTS.FULL_STATE,

      states: {}
    });
  }

  // #endregion


  // #region Unmapped Discord Users

  /**
   * Record a Discord user which does not currently map to a Foundry User.
   */
  recordUnmappedUser({
    discordUserId,
    username,
    nick,
    timestamp = nowTs()
  } = {}) {
    requireGM();

    const id =
      normalizeDiscordUserId(
        discordUserId
      );

    if (!id) {
      return null;
    }

    const record = {
      discordUserId:
        id,

      username:
        username
        ?? undefined,

      nick:
        nick
        ?? undefined,

      lastSeen:
        Number(timestamp)
        || nowTs()
    };

    this._unmappedUsers.set(
      id,
      record
    );

    this._emit({
      type:
        RELAY_STATE_EVENTS.UNMAPPED_UPDATE,

      unmappedUsers:
        this.getUnmappedUsers()
    });

    return {
      ...record
    };
  }

  /**
   * Remove a Discord user from the unmapped diagnostics list.
   *
   * The relay controller can call this after a mapping becomes available.
   */
  clearUnmappedUser(
    discordUserId
  ) {
    requireGM();

    const id =
      normalizeDiscordUserId(
        discordUserId
      );

    if (!id) {
      return false;
    }

    const removed =
      this._unmappedUsers.delete(id);

    if (removed) {
      this._emit({
        type:
          RELAY_STATE_EVENTS.UNMAPPED_UPDATE,

        unmappedUsers:
          this.getUnmappedUsers()
      });
    }

    return removed;
  }

  /**
   * Return unmapped Discord-user diagnostics.
   */
  getUnmappedUsers() {
    return Array.from(
      this._unmappedUsers.values()
    ).map(
      (entry) => ({
        ...entry
      })
    );
  }

  // #endregion


  // #region Full State Snapshot

  /**
   * Return the complete authoritative relay state.
   *
   * This will later be used by socket-service.js for late-client
   * synchronization.
   */
  getFullState() {
    return {
      protocolVersion:
        PROTOCOL_VERSION,

      health:
        this.getRelayHealth(),

      speaking:
        this.getSpeakingStates(),

      unmappedUsers:
        this.getUnmappedUsers(),

      generatedAt:
        nowTs()
    };
  }

  // #endregion


  // #region Watchdog

  /**
   * Start relay-health and stale-speaker monitoring.
   *
   * Intended to run only on the authoritative GM relay host.
   */
  startWatchdog() {
    requireGM();

    if (this._watchdogTimer) {
      return;
    }

    this._watchdogTimer =
      globalThis.setInterval(
        () => {
          this._runWatchdog();
        },
        WATCHDOG_INTERVAL_MS
      );
  }

  /**
   * Stop relay-health and stale-speaker monitoring.
   */
  stopWatchdog() {
    if (!this._watchdogTimer) {
      return;
    }

    globalThis.clearInterval(
      this._watchdogTimer
    );

    this._watchdogTimer =
      null;
  }

  /**
   * Perform one watchdog pass.
   */
  _runWatchdog() {
    if (!game.user?.isGM) {
      return;
    }

    const currentTime =
      nowTs();

    this._checkRelayHeartbeat(
      currentTime
    );

    this._checkStaleSpeakers(
      currentTime
    );
  }

  /**
   * Mark the relay stale if heartbeats stop arriving.
   */
  _checkRelayHeartbeat(
    currentTime
  ) {
    if (
      this._relayStatus
      !== RELAY_STATUS.CONNECTED
    ) {
      return;
    }

    if (!this._lastHeartbeat) {
      return;
    }

    const timeout =
      this._heartbeatTimeoutOverrideMs
      ?? DEFAULT_RELAY_HEARTBEAT_TIMEOUT_MS;

    if (
      currentTime
      - this._lastHeartbeat
      <= timeout
    ) {
      return;
    }

    this._setRelayStatus(
      RELAY_STATUS.STALE
    );
  }

  /**
   * Clear speaking=true records which have received no sufficiently recent
   * authoritative Discord update.
   *
   * This protects clients from a user becoming permanently stuck in the
   * talking state if a speaking=false event is lost.
   */
  _checkStaleSpeakers(
    currentTime
  ) {
    const timeout =
      getStaleSpeakerTimeoutMs();

    for (
      const [discordUserId, state]
      of this._speakingStates.entries()
    ) {
      if (!state.speaking) {
        continue;
      }

      if (
        currentTime
        - state.updatedAt
        <= timeout
      ) {
        continue;
      }

      const nextState = {
        ...state,

        speaking: false,

        updatedAt:
          currentTime
      };

      this._speakingStates.set(
        discordUserId,
        nextState
      );

      this._emit({
        type:
          RELAY_STATE_EVENTS.SPEAKING_UPDATE,

        reason:
          "stale-speaker-timeout",

        state: {
          ...nextState
        }
      });
    }
  }
  
    /**
   * Immediately perform one watchdog pass.
   *
   * Primarily exposed for deterministic development/testing so stale-state
   * behavior does not require waiting for the normal watchdog interval.
   */
  runWatchdogNow() {
    requireGM();

    this._runWatchdog();

    return this.getFullState();
  }

  // #endregion


  // #region Event Subscription

  /**
   * Subscribe to authoritative relay-state changes.
   *
   * Returns an unsubscribe function.
   */
  subscribe(callback) {
    if (
      typeof callback
      !== "function"
    ) {
      throw new TypeError(
        "RelayStateStore.subscribe requires a callback function."
      );
    }

    this._listeners.add(
      callback
    );

    return () => {
      this._listeners.delete(
        callback
      );
    };
  }

  /**
   * Notify relay-state consumers.
   */
  _emit(event) {
    for (
      const listener
      of this._listeners
    ) {
      try {
        listener(event);
      } catch (error) {
        console.error(
          `${LOG_PREFIX} Relay state listener failed.`,
          error
        );
      }
    }
  }

  // #endregion


  // #region Lifecycle

  /**
   * Stop timers and clear local runtime state.
   */
  destroy() {
    this.stopWatchdog();

    this._listeners.clear();
    this._speakingStates.clear();
    this._unmappedUsers.clear();
  }

  // #endregion
}

// #endregion


// #region Singleton

/**
 * Shared GM-authoritative relay state.
 */
export const relayState =
  new RelayStateStore();

// #endregion