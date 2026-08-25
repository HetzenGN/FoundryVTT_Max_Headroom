// scripts/relay/socket-service.js

// #region Imports

import {
  MODULE_ID,
  PROTOCOL_VERSION,
  SOCKET_CHANNEL,
  SOCKET_EVENTS,
  nowTs
} from "../../shared/protocol.js";

import {
  isDebugEnabled
} from "../settings.js";

import {
  findUserByDiscordId
} from "../portraits/portrait-flags.js";

import {
  portraitState
} from "../portraits/portrait-state.js";

import {
  relayState,
  RELAY_STATE_EVENTS
} from "./relay-state.js";

// #endregion


// #region Constants

const LOG_PREFIX = "[FoundryVTT_Max_Headroom]";

const AUTHORITATIVE_SOCKET_EVENTS =
  new Set([
    SOCKET_EVENTS.SPEAKING_UPDATE,
    SOCKET_EVENTS.FULLSYNC_RESPONSE,
    SOCKET_EVENTS.RESET_SPEAKING
  ]);

// #endregion


// #region Internal Helpers

function debugLog(...args) {
  if (!isDebugEnabled()) {
    return;
  }

  console.debug(
    `${LOG_PREFIX} [Socket]`,
    ...args
  );
}


/**
 * Return whether a Foundry User ID belongs to a GM.
 */
function isGMUserId(userId) {
  if (!userId) {
    return false;
  }

  return Boolean(
    game.users.get(userId)?.isGM
  );
}


/**
 * Validate the common socket envelope.
 */
function isSocketEnvelope(payload) {
  if (
    !payload
    || typeof payload !== "object"
  ) {
    return false;
  }

  if (
    payload.version !== PROTOCOL_VERSION
  ) {
    return false;
  }

  if (
    !Object.values(SOCKET_EVENTS)
      .includes(payload.event)
  ) {
    return false;
  }

  if (
    typeof payload.senderUserId
    !== "string"
    || !payload.senderUserId
  ) {
    return false;
  }

  if (
    typeof payload.timestamp
    !== "number"
  ) {
    return false;
  }

  return true;
}


/**
 * Normalize client portrait state received through a full sync.
 */
function normalizeClientPortraitState(
  state = {}
) {
  return {
    discordUserId:
      String(
        state.discordUserId
        ?? ""
      ),

    speaking:
      Boolean(state.speaking),

    muted:
      Boolean(state.muted),

    deafened:
      Boolean(state.deafened),

    updatedAt:
      Number.isFinite(
        Number(state.updatedAt)
      )
        ? Number(state.updatedAt)
        : nowTs()
  };
}

// #endregion


// #region Socket Service

/**
 * Foundry module socket bridge.
 *
 * Responsibilities:
 *
 * RelayStateStore
 *      ↓
 * authoritative socket packets
 *      ↓
 * Foundry module socket
 *      ↓
 * PortraitStateStore
 *
 * The Portrait Bar itself never communicates with this service directly.
 */
export class SocketService {
  constructor() {
    // #region Runtime State

    this._initialized = false;

    /**
     * Whether THIS client is currently acting as the authoritative
     * relay host.
     *
     * The future Relay Controller owns the decision to enable this.
     */
    this._authoritative = false;

    /**
     * Foundry User ID of the currently recognized relay-host GM.
     *
     * This allows clients to reject authoritative packets from other
     * users once a host has been established.
     */
    this._authorityUserId = null;

    this._unsubscribeRelayState = null;

    this._boundSocketHandler =
      this._onSocketMessage.bind(this);

    // #endregion
  }


  // #region Initialization

  /**
   * Register the Foundry module socket listener.
   *
   * This should run once on every connected Foundry client.
   */
  initialize() {
    if (this._initialized) {
      return;
    }

    game.socket.on(
      SOCKET_CHANNEL,
      this._boundSocketHandler
    );

    this._initialized = true;

    debugLog(
      `Listening on ${SOCKET_CHANNEL}`
    );
  }


  /**
   * Remove socket listeners and relay-state subscriptions.
   */
  destroy() {
    if (this._initialized) {
      game.socket.off(
        SOCKET_CHANNEL,
        this._boundSocketHandler
      );
    }

    this.setAuthoritative(false);

    this._initialized = false;
    this._authorityUserId = null;
  }

  // #endregion


  // #region Authority Management

  /**
   * Set the Foundry User which clients should recognize as the current
   * authoritative relay host.
   *
   * The Relay Controller will eventually keep this synchronized.
   */
  setAuthorityUserId(userId) {
    if (!userId) {
      this._authorityUserId = null;

      debugLog(
        "Cleared authoritative relay host."
      );

      return;
    }

    const user =
      game.users.get(
        String(userId)
      );

    if (!user?.isGM) {
      throw new Error(
        `${LOG_PREFIX} Socket authority must be a Foundry GM.`
      );
    }

    this._authorityUserId =
      user.id;

    debugLog(
      "Authoritative relay host:",
      user.name,
      user.id
    );
  }


  /**
   * Enable or disable authoritative behavior on this client.
   *
   * Only a GM may become authoritative.
   */
  setAuthoritative(enabled) {
    const next =
      Boolean(enabled);

    if (
      next
      && !game.user?.isGM
    ) {
      throw new Error(
        `${LOG_PREFIX} Only a GM may become the authoritative relay host.`
      );
    }

    if (
      this._authoritative
      === next
    ) {
      return;
    }

    this._authoritative =
      next;

    if (next) {
      this.setAuthorityUserId(
        game.user.id
      );

      this._subscribeToRelayState();

      relayState.startWatchdog();

      /*
       * Establish authoritative state immediately for already-connected
       * clients.
       */
      this.broadcastFullSync();

      debugLog(
        "This client is now authoritative."
      );

      return;
    }

    this._unsubscribeFromRelayState();

    relayState.stopWatchdog();

    debugLog(
      "This client is no longer authoritative."
    );
  }


  /**
   * Return whether this client currently owns authoritative socket output.
   */
  isAuthoritative() {
    return this._authoritative;
  }


  /**
   * Return the recognized relay-host User ID.
   */
  getAuthorityUserId() {
    return this._authorityUserId;
  }

  // #endregion


  // #region Relay State Subscription

  /**
   * Listen for authoritative relay-state changes.
   */
  _subscribeToRelayState() {
    if (this._unsubscribeRelayState) {
      return;
    }

    this._unsubscribeRelayState =
      relayState.subscribe(
        (event) => {
          this._onRelayStateEvent(
            event
          );
        }
      );
  }


  /**
   * Stop listening to authoritative relay state.
   */
  _unsubscribeFromRelayState() {
    if (!this._unsubscribeRelayState) {
      return;
    }

    this._unsubscribeRelayState();

    this._unsubscribeRelayState =
      null;
  }


  /**
   * Convert RelayStateStore events into socket output.
   */
  _onRelayStateEvent(event) {
    if (!this._authoritative) {
      return;
    }

    switch (event.type) {
      case RELAY_STATE_EVENTS.SPEAKING_UPDATE:
        this._publishSpeakingState(
          event.state,
          event.reason
        );
        break;

      case RELAY_STATE_EVENTS.FULL_STATE:
        this.broadcastFullSync();
        break;

      /*
       * resetSpeakingStates() already emits an individual
       * SPEAKING_UPDATE for each affected Discord user.
       */
      case RELAY_STATE_EVENTS.RESET_SPEAKING:
        break;

      default:
        break;
    }
  }

  // #endregion


  // #region Socket Envelope Creation

  /**
   * Create the common packet envelope.
   */
  _makeEnvelope(
    event,
    data = {}
  ) {
    return {
      event,

      version:
        PROTOCOL_VERSION,

      senderUserId:
        game.user.id,

      authorityUserId:
        this._authorityUserId,

      timestamp:
        nowTs(),

      ...data
    };
  }


  /**
   * Emit one packet through Foundry's module socket.
   */
  _emit(payload) {
    debugLog(
      "Emitting:",
      payload
    );

    game.socket.emit(
      SOCKET_CHANNEL,
      payload
    );
  }

  // #endregion


  // #region Incremental Speaking Updates

  /**
   * Convert one authoritative Discord state into a Foundry User state and
   * distribute it.
   */
  _publishSpeakingState(
    discordState,
    reason = "relay-event"
  ) {
    const discordUserId =
      String(
        discordState?.discordUserId
        ?? ""
      );

    if (!discordUserId) {
      return;
    }

    const user =
      findUserByDiscordId(
        discordUserId
      );

    /*
     * Unmapped users remain a GM Relay Controller diagnostic concern.
     * They do not create arbitrary PortraitStateStore entries.
     */
    if (!user) {
      debugLog(
        "Skipping unmapped Discord user:",
        discordUserId
      );

      return;
    }

    const data = {
      userId:
        user.id,

      discordUserId,

      speaking:
        Boolean(
          discordState.speaking
        ),

      muted:
        Boolean(
          discordState.muted
        ),

      deafened:
        Boolean(
          discordState.deafened
        ),

      updatedAt:
        Number(
          discordState.updatedAt
          ?? nowTs()
        ),

      reason
    };

    /*
     * Foundry's module socket relays packets to other clients.
     * Apply the update locally as well so the authoritative GM sees the
     * same state immediately.
     */
    this._applySpeakingUpdate(
      data
    );

    this._emit(
      this._makeEnvelope(
        SOCKET_EVENTS.SPEAKING_UPDATE,
        {
          data
        }
      )
    );
  }


  /**
   * Apply one authoritative speaking update to local portrait state.
   */
  _applySpeakingUpdate(data) {
    const userId =
      String(
        data?.userId
        ?? ""
      );

    if (
      !userId
      || !game.users.get(userId)
    ) {
      debugLog(
        "Rejected speaking update for unknown Foundry User:",
        userId
      );

      return false;
    }

    portraitState.setSpeakingState(
      userId,
      {
        discordUserId:
          data.discordUserId,

        speaking:
          Boolean(
            data.speaking
          ),

        muted:
          Boolean(
            data.muted
          ),

        deafened:
          Boolean(
            data.deafened
          ),

        updatedAt:
          Number(
            data.updatedAt
            ?? nowTs()
          )
      }
    );

    return true;
  }

  // #endregion


  // #region Full Synchronization

  /**
   * Build a Foundry-User-keyed snapshot from authoritative Discord state.
   */
  _buildPortraitStateSnapshot() {
    const speakingStates =
      relayState.getSpeakingStates();

    const snapshot = {};

    for (
      const [discordUserId, state]
      of Object.entries(
        speakingStates
      )
    ) {
      const user =
        findUserByDiscordId(
          discordUserId
        );

      if (!user) {
        continue;
      }

      snapshot[user.id] = {
        discordUserId,

        speaking:
          Boolean(state.speaking),

        muted:
          Boolean(state.muted),

        deafened:
          Boolean(state.deafened),

        updatedAt:
          Number(
            state.updatedAt
            ?? nowTs()
          )
      };
    }

    return snapshot;
  }


  /**
   * Request current authoritative state.
   *
   * Any client may issue this request. Only the active authoritative
   * service should respond.
   */
  requestFullSync() {
    if (!this._initialized) {
      return;
    }

    this._emit(
      this._makeEnvelope(
        SOCKET_EVENTS.FULLSYNC_REQUEST,
        {
          requesterUserId:
            game.user.id
        }
      )
    );

    debugLog(
      "Requested full state synchronization."
    );
  }


  /**
   * Broadcast authoritative current state.
   *
   * targetUserId:
   * - null -> all clients may apply it
   * - User ID -> only that client applies it
   */
  broadcastFullSync(
    targetUserId = null
  ) {
    if (!this._authoritative) {
      return false;
    }

    const states =
      this._buildPortraitStateSnapshot();

    const payload =
      this._makeEnvelope(
        SOCKET_EVENTS.FULLSYNC_RESPONSE,
        {
          targetUserId,
          states
        }
      );

    /*
     * If broadcasting to everyone, also apply the authoritative snapshot
     * on the host itself.
     */
    if (!targetUserId) {
      portraitState.replaceAll(
        states
      );
    }

    this._emit(payload);

    return true;
  }


  /**
   * Apply a full authoritative state snapshot.
   */
  _applyFullSync(states) {
    if (
      !states
      || typeof states !== "object"
      || Array.isArray(states)
    ) {
      debugLog(
        "Rejected malformed full sync."
      );

      return false;
    }

    const normalized = {};

    for (
      const [userId, state]
      of Object.entries(states)
    ) {
      /*
       * Never create portrait state for an unknown Foundry User.
       */
      if (!game.users.get(userId)) {
        continue;
      }

      normalized[userId] =
        normalizeClientPortraitState(
          state
        );
    }

    portraitState.replaceAll(
      normalized
    );

    debugLog(
      "Applied full state synchronization:",
      normalized
    );

    return true;
  }

  // #endregion


  // #region Reset Speaking

  /**
   * Tell clients to immediately reset all speaking state.
   *
   * This is primarily intended for explicit GM administrative resets.
   */
  broadcastResetSpeaking() {
    if (!this._authoritative) {
      return false;
    }

    portraitState.resetSpeakingStates();

    this._emit(
      this._makeEnvelope(
        SOCKET_EVENTS.RESET_SPEAKING
      )
    );

    return true;
  }

  // #endregion


  // #region Incoming Socket Handling

  /**
   * Process one incoming packet from the Foundry module socket.
   */
  _onSocketMessage(payload) {
    debugLog(
      "Received:",
      payload
    );

    if (!isSocketEnvelope(payload)) {
      debugLog(
        "Rejected malformed or incompatible socket packet."
      );

      return;
    }

    switch (payload.event) {
      case SOCKET_EVENTS.FULLSYNC_REQUEST:
        this._handleFullSyncRequest(
          payload
        );
        break;

      case SOCKET_EVENTS.SPEAKING_UPDATE:
      case SOCKET_EVENTS.FULLSYNC_RESPONSE:
      case SOCKET_EVENTS.RESET_SPEAKING:
        if (
          !this._isTrustedAuthoritativePacket(
            payload
          )
        ) {
          debugLog(
            "Rejected unauthorized authoritative packet.",
            payload
          );

          return;
        }

        this._handleAuthoritativePacket(
          payload
        );
        break;

      default:
        break;
    }
  }


  /**
   * Verify that an incoming authoritative packet identifies a valid GM
   * and, once known, the currently selected relay host.
   */
  _isTrustedAuthoritativePacket(
    payload
  ) {
    if (
      !AUTHORITATIVE_SOCKET_EVENTS.has(
        payload.event
      )
    ) {
      return false;
    }

    if (
      !isGMUserId(
        payload.senderUserId
      )
    ) {
      return false;
    }

    if (
      payload.authorityUserId
      !== payload.senderUserId
    ) {
      return false;
    }

    /*
     * Once the active relay host is known, reject other GMs.
     */
    if (
      this._authorityUserId
      && payload.senderUserId
        !== this._authorityUserId
    ) {
      return false;
    }

    /*
     * During initial bootstrap, a valid GM authoritative packet can
     * establish which GM owns the relay.
     *
     * The Relay Controller will later provide explicit host ownership
     * and eliminate this bootstrap ambiguity.
     */
    if (!this._authorityUserId) {
      this._authorityUserId =
        payload.senderUserId;

      debugLog(
        "Learned relay host from authoritative packet:",
        this._authorityUserId
      );
    }

    return true;
  }


  /**
   * Handle ordinary client full-sync requests.
   */
  _handleFullSyncRequest(
    payload
  ) {
    if (!this._authoritative) {
      return;
    }

    const requesterUserId =
      String(
        payload.requesterUserId
        ?? payload.senderUserId
        ?? ""
      );

    if (
      !requesterUserId
      || !game.users.get(
        requesterUserId
      )
    ) {
      debugLog(
        "Rejected full-sync request for unknown User."
      );

      return;
    }

    debugLog(
      "Responding to full-sync request:",
      requesterUserId
    );

    this.broadcastFullSync(
      requesterUserId
    );
  }


  /**
   * Dispatch an accepted authoritative packet.
   */
  _handleAuthoritativePacket(
    payload
  ) {
    switch (payload.event) {
      case SOCKET_EVENTS.SPEAKING_UPDATE:
        this._applySpeakingUpdate(
          payload.data
        );
        break;

      case SOCKET_EVENTS.FULLSYNC_RESPONSE:
        /*
         * A targeted response should only be applied by the intended
         * client.
         */
        if (
          payload.targetUserId
          && payload.targetUserId
            !== game.user.id
        ) {
          return;
        }

        this._applyFullSync(
          payload.states
        );
        break;

      case SOCKET_EVENTS.RESET_SPEAKING:
        portraitState.resetSpeakingStates();
        break;

      default:
        break;
    }
  }

  // #endregion


  // #region Diagnostics

  /**
   * Return a lightweight socket-service status snapshot.
   */
  getStatus() {
    return {
      initialized:
        this._initialized,

      authoritative:
        this._authoritative,

      authorityUserId:
        this._authorityUserId,

      channel:
        SOCKET_CHANNEL
    };
  }

  // #endregion
}

// #endregion


// #region Singleton

export const socketService =
  new SocketService();

// #endregion