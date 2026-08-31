// scripts/relay/relay-controller.js

// #region Imports

import {
  MODULE_ID,
  PROTOCOL_VERSION,
  MESSAGE_SOURCES,
  nowTs,
  makeDiscordSpeaking,
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

import {
  discordUserDirectory
} from "./discord-user-directory.js";

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

const MAX_MESSAGE_AGE_MS = 60000;
const MAX_FUTURE_SKEW_MS = 5000;

const EXTENSION_HEARTBEAT_TIMEOUT_MS = 90000;

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

    this._popupWindow = null;

    this._lastRejectedMessage = null;

    this._extensionIngressCount = 0;

    this._lastExtensionEventAt = null;

    this._lastExtensionHeartbeatAt =
      null;

    this._extensionVersion =
      "";

    this._extensionChannelId =
      "";

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


    this._isLocalHost =
      true;


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


    if (closePopup) {
      this.closeRelayPopup();
    }


    socketService.setAuthoritative(
      false
    );


    this._isLocalHost =
      false;


    debugLog(
      "Local GM relinquished relay host."
    );
  }

  // #endregion

  // #region Popup Management

/**
 * Open the configured Discord StreamKit Voice page.
 *
 * The Chromium companion extension now owns relay
 * transport and health. This window is only a
 * convenient StreamKit launcher.
 */
openRelayPopup() {
  requireGM();


  if (!this._isLocalHost) {
    throw new Error(
      `${LOG_PREFIX} Claim relay-host status before opening StreamKit.`
    );
  }


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


  const popupWindow =
    globalThis.open(
      url.toString(),
      RELAY_POPUP_NAME,
      RELAY_POPUP_FEATURES
    );


  if (!popupWindow) {
    throw new Error(
      `${LOG_PREFIX} StreamKit window was blocked by the browser.`
    );
  }


  /*
   * Retain the reference only for best-effort local
   * cleanup. StreamKit/browser isolation may sever
   * the relationship, so it is not relay health.
   */
  this._popupWindow =
    popupWindow;


  return true;
}


  /**
   * Best-effort close of the locally tracked
   * StreamKit launcher window.
   */
  closeRelayPopup() {
    try {
      if (
        this._popupWindow
        && !this._popupWindow.closed
      ) {
        this._popupWindow.close();
      }

    } catch {
      /*
      * StreamKit/browser isolation may prevent
      * cross-origin window cleanup.
      */
    }


    this._popupWindow =
      null;
  }

  // #endregion

  // #region Extension Ingress

/**
 * Receive companion-extension connection health.
 */
receiveExtensionRelayHealth(
  rawPayload
) {
  if (
    !game.user?.isGM
    || !this._isLocalHost
  ) {
    return {
      ok: false,
      error:
        "not-relay-host"
    };
  }


  const validation =
    this._validateExtensionRelayHealth(
      rawPayload
    );


  if (!validation.valid) {
    this._recordRejectedMessage(
      `Extension health ingress: ${validation.reason}`,
      rawPayload
    );


    return {
      ok: false,

      error:
        "invalid-extension-health",

      reason:
        validation.reason
    };
  }


  const health =
    validation.payload;


  this._extensionVersion =
    health.extensionVersion;

  this._extensionChannelId =
    health.channelId;

  this._lastExtensionHeartbeatAt =
    nowTs();


  const scriptVersion =
    `Chromium Extension ${health.extensionVersion}`;


  switch (health.state) {
    case "ready":
      relayState.markReady({
        protocolVersion:
          PROTOCOL_VERSION,

        scriptVersion,

        heartbeatTimeoutMs:
          EXTENSION_HEARTBEAT_TIMEOUT_MS
      });

      break;


    case "heartbeat":
      relayState.recordHeartbeat({
        protocolVersion:
          PROTOCOL_VERSION,

        scriptVersion,

        timestamp:
          health.observedAt,

        heartbeatTimeoutMs:
          EXTENSION_HEARTBEAT_TIMEOUT_MS
      });

      break;


    case "disconnected":
      relayState.resetSpeakingStates(
        "extension-disconnected"
      );

      socketService
        .broadcastResetSpeaking();

      relayState.markDisconnected();

      break;


    default:
      break;
  }


  return {
    ok: true,

    state:
      health.state,

    extensionVersion:
      health.extensionVersion,

    channelId:
      health.channelId
  };
}


/**
 * Validate extension relay-health metadata.
 */
_validateExtensionRelayHealth(
  payload
) {
  if (
    !payload
    || typeof payload !== "object"
  ) {
    return {
      valid: false,
      reason:
        "Extension health payload is not an object."
    };
  }


  const acceptedStates =
    new Set([
      "ready",
      "heartbeat",
      "disconnected"
    ]);


  if (
    !acceptedStates.has(
      payload.state
    )
  ) {
    return {
      valid: false,
      reason:
        "Extension health payload has an invalid state."
    };
  }


  const channelId =
    typeof payload.channelId
      === "string"
      ? payload.channelId.trim()
      : "";


  if (
    !/^\d+$/.test(
      channelId
    )
  ) {
    return {
      valid: false,
      reason:
        "Extension health payload has an invalid Discord channel ID."
    };
  }


  const extensionVersion =
    typeof payload.extensionVersion
      === "string"
      ? payload.extensionVersion.trim()
      : "";


  if (
    !extensionVersion
    || extensionVersion.length > 32
  ) {
    return {
      valid: false,
      reason:
        "Extension health payload has an invalid extension version."
    };
  }


  const observedAt =
    Number(
      payload.observedAt
    );


  if (
    !isFreshTimestamp(
      observedAt
    )
  ) {
    return {
      valid: false,
      reason:
        "Extension health timestamp is stale or invalid."
    };
  }


  return {
    valid: true,

    payload: {
      state:
        payload.state,

      channelId,

      extensionVersion,

      observedAt
    }
  };
}


/**
 * Count any valid extension traffic as evidence
 * that the companion transport is currently alive.
 */
_recordExtensionActivity(
  timestamp = nowTs()
) {
  this._lastExtensionEventAt =
    nowTs();


  relayState.recordHeartbeat({
    protocolVersion:
      PROTOCOL_VERSION,

    scriptVersion:
      this._extensionVersion
        ? `Chromium Extension ${this._extensionVersion}`
        : "Chromium Extension",

    timestamp,

    heartbeatTimeoutMs:
      EXTENSION_HEARTBEAT_TIMEOUT_MS
  });
}

/**
 * Receive one speaking event delivered by the
 * Max Headroom Chromium companion extension.
 *
 * The extension transport does NOT enter through
 * _validateWindowMessage(). That validator belongs
 * specifically to the legacy popup/postMessage
 * transport and remains unchanged.
 *
 * Once the extension-specific envelope is validated,
 * it is converted into the normal shared-protocol
 * DISCORD_SPEAKING message and enters the existing
 * relay processing path.
 */
receiveExtensionSpeakingEvent(
  rawPayload
) {
  if (
    !game.user?.isGM
    || !this._isLocalHost
  ) {
    return {
      ok: false,
      error:
        "not-relay-host"
    };
  }


  const validation =
    this._validateExtensionSpeakingEvent(
      rawPayload
    );


  if (!validation.valid) {
    this._recordRejectedMessage(
      `Extension ingress: ${validation.reason}`,
      rawPayload
    );

    return {
      ok: false,

      error:
        "invalid-extension-payload",

      reason:
        validation.reason
    };
  }


  const extensionEvent =
    validation.payload;


  /**
   * Receive one speaking event delivered by the
   * Max Headroom Chromium companion extension.
   *
   * The extension envelope is validated here, then
   * converted into the module's canonical Discord
   * speaking record and applied through the existing
   * authoritative relay-state path.
   */
  const protocolPayload =
    makeDiscordSpeaking({
      discordUserId:
        extensionEvent.discordUserId,

      speaking:
        extensionEvent.speaking,

      channelId:
        extensionEvent.channelId,

      timestamp:
        extensionEvent.observedAt,

      source:
        MESSAGE_SOURCES.STREAMKIT
    });


  this._extensionIngressCount += 1;


  this._recordExtensionActivity(
    extensionEvent.observedAt
  );


  /*
  * Extension ingress has already been validated.
  *
  * Enter the shared Discord-speaking processing
  * path directly.
  */
  this._handleDiscordSpeaking(
    protocolPayload
  );


  return {
    ok: true,

    type:
      protocolPayload.type,

    discordUserId:
      protocolPayload.discordUserId,

    speaking:
      protocolPayload.speaking
  };
}

/**
 * Receive Discord user metadata discovered by the
 * Chromium companion extension.
 */
receiveExtensionDiscordUserEvent(
  rawPayload
) {
  if (
    !game.user?.isGM
    || !this._isLocalHost
  ) {
    return {
      ok: false,
      error:
        "not-relay-host"
    };
  }


  const validation =
    this._validateExtensionDiscordUserEvent(
      rawPayload
    );


  if (!validation.valid) {
    this._recordRejectedMessage(
      `Extension user ingress: ${validation.reason}`,
      rawPayload
    );

    return {
      ok: false,

      error:
        "invalid-extension-user-payload",

      reason:
        validation.reason
    };
  }

  this._recordExtensionActivity(
    validation.payload.observedAt
  );

  const entry =
    discordUserDirectory.record(
      validation.payload
    );


  return {
    ok: true,

    discordUserId:
      entry.discordUserId,

    displayName:
      entry.displayName,

    present:
      entry.present
  };
}


/**
 * Return users observed through the current
 * extension/StreamKit session.
 */
getDiscoveredDiscordUsers() {
  return discordUserDirectory.list();
}


/**
 * Validate one extension Discord-user observation.
 */
_validateExtensionDiscordUserEvent(
  payload
) {
  if (
    !payload
    || typeof payload !== "object"
  ) {
    return {
      valid: false,
      reason:
        "Extension user payload is not an object."
    };
  }


  const acceptedEvents =
    new Set([
      "VOICE_STATE_CREATE",
      "VOICE_STATE_UPDATE",
      "VOICE_STATE_DELETE"
    ]);


  if (
    !acceptedEvents.has(
      payload.eventName
    )
  ) {
    return {
      valid: false,
      reason:
        "Extension user payload has an invalid event name."
    };
  }


  const discordUserId =
    typeof payload.discordUserId
      === "string"
      ? payload.discordUserId.trim()
      : "";


  if (
    !/^\d+$/.test(
      discordUserId
    )
  ) {
    return {
      valid: false,
      reason:
        "Extension user payload has an invalid Discord User ID."
    };
  }


  const guildId =
    typeof payload.guildId
      === "string"
      ? payload.guildId.trim()
      : "";


  const channelId =
    typeof payload.channelId
      === "string"
      ? payload.channelId.trim()
      : "";


  if (
    !/^\d+$/.test(guildId)
    || !/^\d+$/.test(
      channelId
    )
  ) {
    return {
      valid: false,
      reason:
        "Extension user payload has invalid Discord guild/channel information."
    };
  }


  const expectedPresent =
    payload.eventName
      !== "VOICE_STATE_DELETE";


  if (
    payload.present
    !== expectedPresent
  ) {
    return {
      valid: false,
      reason:
        "Extension user presence does not match its voice-state event."
    };
  }


  const observedAt =
    Number(
      payload.observedAt
    );


  if (
    !isFreshTimestamp(
      observedAt
    )
  ) {
    return {
      valid: false,
      reason:
        "Extension user event timestamp is stale or invalid."
    };
  }


  return {
    valid: true,

    payload: {
      eventName:
        payload.eventName,

      discordUserId,

      username:
        typeof payload.username
          === "string"
          ? payload.username.trim()
          : "",

      nick:
        typeof payload.nick
          === "string"
          ? payload.nick.trim()
          : "",

      guildId,
      channelId,

      present:
        expectedPresent,

      observedAt
    }
  };
}

/**
 * Validate the small transport envelope supplied
 * by the Chromium extension.
 */
_validateExtensionSpeakingEvent(
  payload
) {
  if (
    !payload
    || typeof payload !== "object"
  ) {
    return {
      valid: false,
      reason:
        "Extension payload is not an object."
    };
  }


  const discordUserId =
    typeof payload.discordUserId
      === "string"
      ? payload.discordUserId.trim()
      : "";


  if (
    !discordUserId
    || !/^\d+$/.test(
      discordUserId
    )
  ) {
    return {
      valid: false,
      reason:
        "Extension payload has an invalid Discord User ID."
    };
  }


  const channelId =
    typeof payload.channelId
      === "string"
      ? payload.channelId.trim()
      : "";


  if (
    !channelId
    || !/^\d+$/.test(
      channelId
    )
  ) {
    return {
      valid: false,
      reason:
        "Extension payload has an invalid Discord channel ID."
    };
  }

  if (
    typeof payload.speaking
      !== "boolean"
  ) {
    return {
      valid: false,
      reason:
        "Extension payload has an invalid speaking state."
    };
  }


  const expectedEventName =
    payload.speaking
      ? "SPEAKING_START"
      : "SPEAKING_STOP";


  if (
    payload.eventName
    !== expectedEventName
  ) {
    return {
      valid: false,

      reason:
        `Extension event name does not match speaking=${String(payload.speaking)}.`
    };
  }


  const observedAt =
    Number(
      payload.observedAt
    );


  if (
    !isFreshTimestamp(
      observedAt
    )
  ) {
    return {
      valid: false,
      reason:
        "Extension speaking event timestamp is stale or invalid."
    };
  }


  return {
    valid: true,

    payload: {
      discordUserId,
      channelId,

      speaking:
        payload.speaking,

      eventName:
        expectedEventName,

      observedAt
    }
  };
}

// #endregion

// #region Validation Diagnostics

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
        ?? payload?.eventName
        ?? payload?.state
        ?? null
    };


    debugLog(
      "Rejected extension relay message:",
      reason,
      payload
    );
  }

// #endregion


// #region Discord Speaking Processing


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

  // #endregion


  // #region Diagnostics

/**
 * Return Relay Controller runtime diagnostics.
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

      transport:
        "chromium-extension",

      extensionVersion:
        this._extensionVersion,

      extensionChannelId:
        this._extensionChannelId,

      lastExtensionHeartbeatAt:
        this._lastExtensionHeartbeatAt,

      extensionIngressCount:
        this._extensionIngressCount,

      lastExtensionEventAt:
        this._lastExtensionEventAt,

      lastRejectedMessage:
        this._lastRejectedMessage
          ? {
              ...this._lastRejectedMessage
            }
          : null
    };
  }
  
  // #endregion
}

// #endregion


// #region Singleton

export const relayController =
  new RelayController();

// #endregion