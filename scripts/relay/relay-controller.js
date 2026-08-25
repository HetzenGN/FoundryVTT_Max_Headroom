// scripts/relay/relay-controller.js

// #region Imports

import {
  MODULE_ID,
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  MESSAGE_SOURCES,
  nowTs,
  isDiscordSpeakingMessage,
  normalizeDiscordSpeakingMessage
} from "../../shared/protocol.js";

import {
  getSetting,
  setSetting,
  SETTING_KEYS,
  isDebugEnabled
} from "../settings.js";

import {
  findUserByDiscordId
} from "../portraits/portrait-flags.js";

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

const RELAY_POPUP_NAME =
  `${MODULE_ID}-streamkit-relay`;

const RELAY_POPUP_FEATURES = [
  "popup=yes",
  "width=1000",
  "height=800",
  "resizable=yes",
  "scrollbars=yes"
].join(",");

const POPUP_CHECK_INTERVAL_MS = 1000;

const MAX_MESSAGE_AGE_MS = 60000;
const MAX_FUTURE_SKEW_MS = 5000;

/**
 * Query-string fields supplied to the external StreamKit relay.
 *
 * The external relay userscript will later consume these.
 */
export const RELAY_QUERY_KEYS =
  Object.freeze({
    NONCE: "maxHeadroomNonce",
    PROTOCOL: "maxHeadroomProtocol",
    OPENER_ORIGIN:
      "maxHeadroomOpenerOrigin"
  });

const ACCEPTED_RELAY_TYPES =
  new Set([
    MESSAGE_TYPES.RELAY_READY,
    MESSAGE_TYPES.RELAY_HEARTBEAT,
    MESSAGE_TYPES.DISCORD_SPEAKING,
    MESSAGE_TYPES.RELAY_ERROR,
    MESSAGE_TYPES.RELAY_DEBUG
  ]);

// #endregion


// #region Internal Helpers

function debugLog(...args) {
  if (!isDebugEnabled()) {
    return;
  }

  console.debug(
    `${LOG_PREFIX} [Relay Controller]`,
    ...args
  );
}


/**
 * Relay-host management is GM-only.
 */
function requireGM() {
  if (!game.user?.isGM) {
    throw new Error(
      `${LOG_PREFIX} Relay-host control is GM-only.`
    );
  }
}


/**
 * Generate a per-session nonce using the browser cryptography API.
 */
function generateNonce() {
  const bytes =
    new Uint8Array(24);

  globalThis.crypto.getRandomValues(
    bytes
  );

  return Array.from(
    bytes,
    (byte) =>
      byte
        .toString(16)
        .padStart(2, "0")
  ).join("");
}


/**
 * Convert a configured URL/origin into its canonical browser origin.
 */
function normalizeOrigin(value) {
  if (!value) {
    return "";
  }

  try {
    return new URL(
      value,
      globalThis.location.href
    ).origin;
  } catch {
    return "";
  }
}


/**
 * Return whether a timestamp is reasonable for a live relay packet.
 */
function isFreshTimestamp(timestamp) {
  const value =
    Number(timestamp);

  if (!Number.isFinite(value)) {
    return false;
  }

  const current =
    nowTs();

  if (
    value
    > current + MAX_FUTURE_SKEW_MS
  ) {
    return false;
  }

  if (
    current - value
    > MAX_MESSAGE_AGE_MS
  ) {
    return false;
  }

  return true;
}

// #endregion


// #region Relay Controller

/**
 * GM-side controller for the external Discord StreamKit relay.
 *
 * Responsibilities:
 *
 * - explicit relay-host ownership
 * - per-session nonce
 * - StreamKit popup lifecycle
 * - window.postMessage listener
 * - origin/source/nonce/version validation
 * - normalized relay-state updates
 *
 * It does not render the GM administration UI.
 */
export class RelayController {
  constructor() {
    // #region Runtime State

    this._initialized = false;

    this._isLocalHost = false;

    this._nonce = null;

    this._popupWindow = null;
    this._popupCheckTimer = null;

    this._lastRejectedMessage = null;

    this._boundMessageHandler =
      this._onWindowMessage.bind(this);

    this._settingHookId = null;

    // #endregion
  }


  // #region Initialization

  /**
   * Initialize relay-host synchronization.
   *
   * Call once after Foundry is ready.
   */
  initialize() {
    if (this._initialized) {
      return;
    }

    socketService.initialize();

    /*
     * World Setting documents are synchronized by Foundry.
     *
     * updateSetting is the document-specific form of the generic
     * updateDocument hook.
     */
    this._settingHookId =
      Hooks.on(
        "updateSetting",
        (setting) => {
          if (
            setting.key
            !== `${MODULE_ID}.${SETTING_KEYS.RELAY_HOST_USER_ID}`
          ) {
            return;
          }

          this._syncHostOwnership();
        }
      );

    this._initialized = true;

    this._syncHostOwnership();

    debugLog(
      "Relay Controller initialized."
    );
  }


  /**
   * Release runtime listeners.
   */
  destroy() {
    this._deactivateLocalHost({
      closePopup: true
    });

    if (
      this._settingHookId !== null
    ) {
      Hooks.off(
        "updateSetting",
        this._settingHookId
      );

      this._settingHookId = null;
    }

    this._initialized = false;
  }

  // #endregion


  // #region Host Ownership

  /**
   * Return the Foundry User ID recorded as relay host.
   */
  getHostUserId() {
    return String(
      getSetting(
        SETTING_KEYS.RELAY_HOST_USER_ID
      )
      ?? ""
    );
  }


  /**
   * Return the configured relay-host User.
   */
  getHostUser() {
    const userId =
      this.getHostUserId();

    if (!userId) {
      return null;
    }

    return (
      game.users.get(userId)
      ?? null
    );
  }


  /**
   * Return whether this browser is currently the relay host.
   */
  isLocalHost() {
    return this._isLocalHost;
  }


  /**
   * Claim relay-host ownership.
   *
   * If another connected GM already owns the relay, the claim is rejected
   * unless force=true.
   *
   * An inactive/disconnected previous host may be replaced normally.
   */
  async claimHost({
    force = false
  } = {}) {
    requireGM();

    const existingHost =
      this.getHostUser();

    if (
      existingHost
      && existingHost.id
        !== game.user.id
      && existingHost.active
      && !force
    ) {
      throw new Error(
        `${LOG_PREFIX} ${existingHost.name} is already the active relay host.`
      );
    }

    await setSetting(
      SETTING_KEYS.RELAY_HOST_USER_ID,
      game.user.id
    );

    /*
     * Re-read server-backed state before considering the claim successful.
     */
    const confirmedHostId =
      this.getHostUserId();

    if (
      confirmedHostId
      !== game.user.id
    ) {
      throw new Error(
        `${LOG_PREFIX} Relay-host claim was not confirmed.`
      );
    }

    this._syncHostOwnership();

    return true;
  }


  /**
   * Release relay-host ownership.
   */
  async releaseHost() {
    requireGM();

    if (
      this.getHostUserId()
      !== game.user.id
    ) {
      return false;
    }

    /*
     * Tell clients to return to idle before authority is relinquished.
     */
    relayState.resetSpeakingStates(
      "relay-host-release"
    );

    socketService.broadcastResetSpeaking();

    relayState.markDisconnected();

    this.closeRelayPopup();

    await setSetting(
      SETTING_KEYS.RELAY_HOST_USER_ID,
      ""
    );

    this._syncHostOwnership();

    return true;
  }


  /**
   * React to the authoritative shared host setting.
   */
  _syncHostOwnership() {
    const hostUserId =
      this.getHostUserId();

    /*
     * All clients use the shared setting to determine which GM's socket
     * packets are authoritative.
     */
    if (
      hostUserId
      && game.users.get(hostUserId)?.isGM
    ) {
      socketService.setAuthorityUserId(
        hostUserId
      );
    } else {
      socketService.setAuthorityUserId(
        null
      );
    }

    const shouldHost =
      Boolean(
        game.user?.isGM
        && hostUserId
          === game.user.id
      );

    if (shouldHost) {
      this._activateLocalHost();
    } else {
      this._deactivateLocalHost();
    }
  }


  /**
   * Activate authoritative services on this GM client.
   */
  _activateLocalHost() {
    if (this._isLocalHost) {
      return;
    }

    this._isLocalHost = true;

    this._nonce =
      generateNonce();

    globalThis.addEventListener(
      "message",
      this._boundMessageHandler
    );

    socketService.setAuthoritative(
      true
    );

    debugLog(
      "Local GM became relay host."
    );
  }


  /**
   * Stop authoritative services on this client.
   */
  _deactivateLocalHost({
    closePopup = true
  } = {}) {
    if (!this._isLocalHost) {
      return;
    }

    globalThis.removeEventListener(
      "message",
      this._boundMessageHandler
    );

    this._stopPopupMonitor();

    if (closePopup) {
      try {
        if (
          this._popupWindow
          && !this._popupWindow.closed
        ) {
          this._popupWindow.close();
        }
      } catch {
        // Ignore browser popup-access failures during teardown.
      }
    }

    this._popupWindow = null;

    socketService.setAuthoritative(
      false
    );

    this._nonce = null;
    this._isLocalHost = false;

    debugLog(
      "Local GM relinquished relay host."
    );
  }

  // #endregion


  // #region Nonce

  /**
   * Return the current session nonce.
   *
   * Primarily useful for diagnostics and future integration testing.
   */
  getNonce() {
    return this._nonce;
  }


  /**
   * Rotate the current relay nonce.
   *
   * Existing external relay messages immediately become invalid.
   */
  regenerateNonce() {
    requireGM();

    if (!this._isLocalHost) {
      throw new Error(
        `${LOG_PREFIX} Only the active relay host may regenerate the nonce.`
      );
    }

    this._nonce =
      generateNonce();

    return this._nonce;
  }

  // #endregion


  // #region Popup Management

  /**
   * Open or reopen the external StreamKit relay page.
   */
  openRelayPopup() {
    requireGM();

    if (!this._isLocalHost) {
      throw new Error(
        `${LOG_PREFIX} Claim relay-host status before opening StreamKit.`
      );
    }

    /*
     * Each popup launch represents a new relay browser session.
     */
    this.regenerateNonce();

    const configuredUrl =
      String(
        getSetting(
          SETTING_KEYS.STREAMKIT_URL
        )
        ?? ""
      ).trim();

    if (!configuredUrl) {
      throw new Error(
        `${LOG_PREFIX} StreamKit Relay URL is not configured.`
      );
    }

    let url;

    try {
      url =
        new URL(
          configuredUrl,
          globalThis.location.href
        );
    } catch {
      throw new Error(
        `${LOG_PREFIX} StreamKit Relay URL is invalid.`
      );
    }

    url.searchParams.set(
      RELAY_QUERY_KEYS.NONCE,
      this._nonce
    );

    url.searchParams.set(
      RELAY_QUERY_KEYS.PROTOCOL,
      String(PROTOCOL_VERSION)
    );

    url.searchParams.set(
      RELAY_QUERY_KEYS.OPENER_ORIGIN,
      globalThis.location.origin
    );

    relayState.markConnecting();

    this._popupWindow =
      globalThis.open(
        url.toString(),
        RELAY_POPUP_NAME,
        RELAY_POPUP_FEATURES
      );

    if (!this._popupWindow) {
      relayState.markError(
        "StreamKit popup was blocked by the browser."
      );

      throw new Error(
        `${LOG_PREFIX} StreamKit popup was blocked by the browser.`
      );
    }

    relayState.setPopupOpen(
      true
    );

    this._startPopupMonitor();

    return true;
  }


  /**
   * Close the currently tracked relay popup.
   */
  closeRelayPopup() {
    this._stopPopupMonitor();

    try {
      if (
        this._popupWindow
        && !this._popupWindow.closed
      ) {
        this._popupWindow.close();
      }
    } catch {
      // Ignore browser cross-window cleanup failures.
    }

    this._popupWindow = null;

    if (
      this._isLocalHost
      && game.user?.isGM
    ) {
      relayState.setPopupOpen(
        false
      );

      relayState.markDisconnected();
    }
  }


  /**
   * Poll the Window.closed state.
   */
  _startPopupMonitor() {
    this._stopPopupMonitor();

    this._popupCheckTimer =
      globalThis.setInterval(
        () => {
          if (!this._popupWindow) {
            return;
          }

          if (!this._popupWindow.closed) {
            return;
          }

          this._stopPopupMonitor();

          this._popupWindow = null;

          if (
            this._isLocalHost
            && game.user?.isGM
          ) {
            relayState.setPopupOpen(
              false
            );

            relayState.markDisconnected();
          }

          debugLog(
            "Relay popup closed."
          );
        },
        POPUP_CHECK_INTERVAL_MS
      );
  }


  /**
   * Stop popup-state polling.
   */
  _stopPopupMonitor() {
    if (!this._popupCheckTimer) {
      return;
    }

    globalThis.clearInterval(
      this._popupCheckTimer
    );

    this._popupCheckTimer = null;
  }

  // #endregion


  // #region postMessage Validation

  /**
   * Receive browser window messages.
   */
  _onWindowMessage(event) {
    if (!this._isLocalHost) {
      return;
    }

    const validation =
      this._validateWindowMessage(
        event
      );

    if (!validation.valid) {
      this._recordRejectedMessage(
        validation.reason,
        event.data
      );

      return;
    }

    this._processRelayPayload(
      validation.payload
    );
  }


  /**
   * Validate browser-level and protocol-level security requirements.
   */
  _validateWindowMessage(event) {
    const expectedOrigin =
      normalizeOrigin(
        getSetting(
          SETTING_KEYS.RELAY_ORIGIN
        )
      );

    if (!expectedOrigin) {
      return {
        valid: false,
        reason:
          "Relay origin is not configured or is invalid."
      };
    }

    if (
      event.origin
      !== expectedOrigin
    ) {
      return {
        valid: false,
        reason:
          `Unexpected origin: ${event.origin}`
      };
    }

    /*
     * If we launched a popup, require the event to originate from exactly
     * that Window object.
     */
    if (
      this._popupWindow
      && event.source
        !== this._popupWindow
    ) {
      return {
        valid: false,
        reason:
          "Message source is not the tracked relay popup."
      };
    }

    const payload =
      event.data;

    if (
      !payload
      || typeof payload !== "object"
    ) {
      return {
        valid: false,
        reason:
          "Payload is not an object."
      };
    }

    if (
      payload.version
      !== PROTOCOL_VERSION
    ) {
      /*
       * This is useful health information even though the packet itself
       * must not be accepted.
       */
      relayState.markIncompatible(
        payload.version
      );

      return {
        valid: false,
        reason:
          `Protocol version ${String(payload.version)} is incompatible.`
      };
    }

    if (
      !ACCEPTED_RELAY_TYPES.has(
        payload.type
      )
    ) {
      return {
        valid: false,
        reason:
          `Unrecognized relay message type: ${String(payload.type)}`
      };
    }

    if (
      payload.nonce
      !== this._nonce
    ) {
      return {
        valid: false,
        reason:
          "Relay nonce does not match the current session."
      };
    }

    if (
      payload.source
      !== MESSAGE_SOURCES.STREAMKIT
    ) {
      return {
        valid: false,
        reason:
          `Unexpected message source: ${String(payload.source)}`
      };
    }

    if (
      !isFreshTimestamp(
        payload.timestamp
      )
    ) {
      return {
        valid: false,
        reason:
          "Relay message timestamp is stale or invalid."
      };
    }

    return {
      valid: true,
      payload
    };
  }


  /**
   * Record a validation rejection for GM diagnostics.
   */
  _recordRejectedMessage(
    reason,
    payload
  ) {
    this._lastRejectedMessage = {
      reason,
      timestamp:
        nowTs(),

      type:
        payload?.type
        ?? null
    };

    debugLog(
      "Rejected relay message:",
      reason,
      payload
    );
  }

  // #endregion


  // #region Relay Message Processing

  /**
   * Dispatch a validated relay payload.
   */
  _processRelayPayload(payload) {
    debugLog(
      "Accepted relay message:",
      payload
    );

    switch (payload.type) {
      case MESSAGE_TYPES.RELAY_READY:
        this._handleRelayReady(
          payload
        );
        break;

      case MESSAGE_TYPES.RELAY_HEARTBEAT:
        this._handleRelayHeartbeat(
          payload
        );
        break;

      case MESSAGE_TYPES.DISCORD_SPEAKING:
        this._handleDiscordSpeaking(
          payload
        );
        break;

      case MESSAGE_TYPES.RELAY_ERROR:
        this._handleRelayError(
          payload
        );
        break;

      case MESSAGE_TYPES.RELAY_DEBUG:
        this._handleRelayDebug(
          payload
        );
        break;

      default:
        break;
    }
  }


  /**
   * Handle StreamKit relay initialization.
   */
  _handleRelayReady(payload) {
    relayState.markReady({
      protocolVersion:
        payload.version,

      scriptVersion:
        payload.scriptVersion
    });
  }


  /**
   * Handle relay heartbeat.
   */
  _handleRelayHeartbeat(payload) {
    relayState.recordHeartbeat({
      protocolVersion:
        payload.version,

      scriptVersion:
        payload.scriptVersion,

      timestamp:
        payload.timestamp
    });
  }


  /**
   * Handle normalized Discord speaking state.
   */
  _handleDiscordSpeaking(payload) {
    if (
      !isDiscordSpeakingMessage(
        payload
      )
    ) {
      this._recordRejectedMessage(
        "Malformed Discord speaking payload.",
        payload
      );

      return;
    }

    const normalized =
      normalizeDiscordSpeakingMessage(
        payload
      );

    if (!normalized) {
      this._recordRejectedMessage(
        "Discord speaking normalization failed.",
        payload
      );

      return;
    }

    const mappedUser =
      findUserByDiscordId(
        normalized.discordUserId
      );

    if (!mappedUser) {
      relayState.recordUnmappedUser({
        discordUserId:
          normalized.discordUserId,

        username:
          normalized.username,

        nick:
          normalized.nick,

        timestamp:
          normalized.timestamp
      });
    } else {
      relayState.clearUnmappedUser(
        normalized.discordUserId
      );
    }

    /*
     * Keep authoritative Discord state even for currently-unmapped users.
     *
     * socket-service.js simply declines to create a portrait for them.
     */
    relayState.updateSpeakingState(
      normalized
    );
  }


  /**
   * Handle external relay error.
   */
  _handleRelayError(payload) {
    const message =
      payload.message
      ?? payload.error
      ?? "Unknown StreamKit relay error.";

    relayState.markError(
      String(message)
    );
  }


  /**
   * Handle optional relay debug information.
   */
  _handleRelayDebug(payload) {
    debugLog(
      "StreamKit debug:",
      payload.message
        ?? payload.data
        ?? payload
    );
  }

  // #endregion


  // #region Diagnostics

  /**
   * Return controller runtime status for the future GM UI.
   */
  getStatus() {
    const host =
      this.getHostUser();

    return {
      initialized:
        this._initialized,

      isLocalHost:
        this._isLocalHost,

      hostUserId:
        host?.id
        ?? "",

      hostUserName:
        host?.name
        ?? "",

      hostActive:
        Boolean(
          host?.active
        ),

      popupOpen:
        Boolean(
          this._popupWindow
          && !this._popupWindow.closed
        ),

      hasNonce:
        Boolean(
          this._nonce
        ),

      expectedOrigin:
        normalizeOrigin(
          getSetting(
            SETTING_KEYS.RELAY_ORIGIN
          )
        ),

      lastRejectedMessage:
        this._lastRejectedMessage
          ? {
              ...this._lastRejectedMessage
            }
          : null
    };
  }

    /**
   * Inject a synthetic browser message through the normal Relay Controller
   * window-message validation and processing path.
   *
   * Intended only for development/testing.
   */
  injectDebugWindowMessage(
    payload,
    {
      origin,
      invalidSource = false
    } = {}
  ) {
    requireGM();

    if (!this._isLocalHost) {
      throw new Error(
        `${LOG_PREFIX} Claim relay-host status before injecting debug relay messages.`
      );
    }

    const expectedOrigin =
      normalizeOrigin(
        getSetting(
          SETTING_KEYS.RELAY_ORIGIN
        )
      );

    const syntheticEvent = {
      data:
        payload,

      origin:
        origin
        ?? expectedOrigin,

      /*
      * When a real popup is open, normal debug events pretend to originate
      * from that exact tracked Window object.
      *
      * invalidSource deliberately supplies a different object.
      */
      source:
        invalidSource
          ? {}
          : (
              this._popupWindow
              ?? null
            )
    };

    this._onWindowMessage(
      syntheticEvent
    );

    return this.getStatus();
  }

  // #endregion
}

// #endregion


// #region Singleton

export const relayController =
  new RelayController();

// #endregion