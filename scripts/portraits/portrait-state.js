// scripts/portraits/portrait-state.js

// #region Imports

import {
  nowTs
} from "../../shared/protocol.js";

import {
  getSetting,
  SETTING_KEYS
} from "../settings.js";

// #endregion

// #region Constants

/**
 * Default transient state for one reactive portrait.
 *
 * None of this data is persisted to Foundry User flags.
 */
export const DEFAULT_PORTRAIT_STATE = Object.freeze({
  discordUserId: "",
  speaking: false,
  muted: false,
  deafened: false,
  updatedAt: 0
});

/**
 * Store event types.
 *
 * Consumers such as portrait-bar.js can subscribe to state changes and
 * patch only the affected portrait tile.
 */
export const PORTRAIT_STATE_EVENTS = Object.freeze({
  UPDATE: "update",
  REMOVE: "remove",
  RESET: "reset",
  REPLACE_ALL: "replace-all"
});

// #endregion

// #region Internal Helpers

/**
 * Normalize a Foundry User ID.
 */
function normalizeUserId(userId) {
  if (userId === null || userId === undefined) {
    return "";
  }

  return String(userId).trim();
}

/**
 * Normalize a Discord User ID.
 */
function normalizeDiscordUserId(discordUserId) {
  if (discordUserId === null || discordUserId === undefined) {
    return "";
  }

  return String(discordUserId).trim();
}

/**
 * Normalize a state object.
 */
function normalizeState(state = {}) {
  return {
    discordUserId: normalizeDiscordUserId(
      state.discordUserId
    ),

    speaking: Boolean(
      state.speaking
    ),

    muted: Boolean(
      state.muted
    ),

    deafened: Boolean(
      state.deafened
    ),

    updatedAt: Number.isFinite(Number(state.updatedAt))
      ? Number(state.updatedAt)
      : nowTs()
  };
}

/**
 * Return the configured speaking decay.
 */
function getSpeechDecayMs() {
  const value = Number(
    getSetting(SETTING_KEYS.SPEECH_DECAY_MS)
  );

  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

/**
 * Compare two normalized states.
 */
function statesEqual(a, b) {
  return (
    a.discordUserId === b.discordUserId
    && a.speaking === b.speaking
    && a.muted === b.muted
    && a.deafened === b.deafened
    && a.updatedAt === b.updatedAt
  );
}

// #endregion

// #region Portrait State Store

/**
 * Runtime state store for the Reactive Portrait Bar.
 *
 * State is keyed by Foundry User ID.
 *
 * This service:
 * - maintains independent state for every portrait
 * - supports multiple simultaneous speakers
 * - manages speaking-stop decay timers
 * - supports full authoritative state replacement
 * - notifies UI consumers about changed users
 *
 * It contains no DOM or ApplicationV2 logic.
 */
export class PortraitStateStore {
  constructor() {
    this._states = new Map();
    this._decayTimers = new Map();
    this._listeners = new Set();
  }

  // #region State Readers

  /**
   * Return a copy of one user's current transient portrait state.
   *
   * Returns null if the user is not currently represented in the store.
   */
  getState(userId) {
    const normalizedUserId = normalizeUserId(userId);

    if (!normalizedUserId) {
      return null;
    }

    const state = this._states.get(normalizedUserId);

    return state
      ? { ...state }
      : null;
  }

  /**
   * Return all states as a new Map.
   *
   * Returned state objects are copied so callers cannot mutate the store
   * without using the store's public methods.
   */
  getAllStates() {
    return new Map(
      Array.from(
        this._states.entries(),
        ([userId, state]) => [
          userId,
          { ...state }
        ]
      )
    );
  }

  /**
   * Return all states as a plain object.
   *
   * Useful later for diagnostics and the module public API.
   */
  toObject() {
    return Object.fromEntries(
      Array.from(
        this._states.entries(),
        ([userId, state]) => [
          userId,
          { ...state }
        ]
      )
    );
  }

  /**
   * Return whether a user currently has runtime state.
   */
  hasState(userId) {
    const normalizedUserId = normalizeUserId(userId);

    return normalizedUserId
      ? this._states.has(normalizedUserId)
      : false;
  }

  // #endregion

  // #region State Initialization

  /**
   * Ensure a user has an entry in the runtime state store.
   *
   * Existing state is preserved.
   */
  ensureState(userId, initialState = {}) {
    const normalizedUserId = normalizeUserId(userId);

    if (!normalizedUserId) {
      throw new TypeError(
        "PortraitStateStore.ensureState requires a Foundry User ID."
      );
    }

    if (this._states.has(normalizedUserId)) {
      return this.getState(normalizedUserId);
    }

    const state = normalizeState({
      ...DEFAULT_PORTRAIT_STATE,
      ...initialState,
      updatedAt:
        initialState.updatedAt
        ?? DEFAULT_PORTRAIT_STATE.updatedAt
    });

    this._states.set(
      normalizedUserId,
      state
    );

    return { ...state };
  }

  // #endregion

  // #region State Updates

  /**
   * Apply a state update immediately.
   *
   * This method does not perform speaking decay. Use setSpeakingState()
   * when processing normal live speaking events.
   */
  updateState(userId, changes = {}) {
    const normalizedUserId = normalizeUserId(userId);

    if (!normalizedUserId) {
      throw new TypeError(
        "PortraitStateStore.updateState requires a Foundry User ID."
      );
    }

    const previousState =
      this._states.get(normalizedUserId)
      ?? normalizeState({
        ...DEFAULT_PORTRAIT_STATE,
        updatedAt: 0
      });

    const nextState = normalizeState({
      ...previousState,
      ...changes,
      updatedAt:
        changes.updatedAt
        ?? nowTs()
    });

    if (statesEqual(previousState, nextState)) {
      return { ...nextState };
    }

    this._states.set(
      normalizedUserId,
      nextState
    );

    this._emit({
      type: PORTRAIT_STATE_EVENTS.UPDATE,
      userId: normalizedUserId,
      state: { ...nextState },
      previousState: { ...previousState }
    });

    return { ...nextState };
  }

/**
 * Apply live speaking state for one user.
 *
 * speaking=true:
 * - cancels any pending idle transition
 * - immediately marks the user as speaking
 *
 * speaking=false:
 * - updates mute/deafen metadata immediately
 * - keeps the portrait speaking during the configured decay
 * - changes speaking to false when the decay expires
 *
 * A new speaking=true event during decay cancels the pending transition.
 */
setSpeakingState(
  userId,
  {
    discordUserId,
    speaking,
    muted,
    deafened,
    updatedAt
  } = {},
  {
    decayMs = getSpeechDecayMs()
  } = {}
) {
  const normalizedUserId =
    normalizeUserId(userId);

  if (!normalizedUserId) {
    throw new TypeError(
      "PortraitStateStore.setSpeakingState requires a Foundry User ID."
    );
  }

  /*
   * Make sure the user exists in the store before processing
   * either speaking direction.
   */
  this.ensureState(
    normalizedUserId,
    {
      discordUserId:
        discordUserId ?? ""
    }
  );

  const current =
    this._states.get(
      normalizedUserId
    );

  const isSpeaking =
    Boolean(speaking);

  // #region Mute Transition

const nextMuted =
  muted === undefined
    ? Boolean(
        current.muted
      )
    : Boolean(muted);


const muteChanged =
  muted !== undefined
  && nextMuted
    !== Boolean(
      current.muted
    );


if (muteChanged) {
  /*
   * Mute/unmute is a direct visual state change.
   * It should not inherit speech-decay timing.
   */
  this._clearDecayTimer(
    normalizedUserId
  );


  return this.updateState(
    normalizedUserId,
    {
      discordUserId:
        discordUserId
        ?? current.discordUserId,

      /*
       * A muted user cannot remain visually
       * speaking. On unmute, use the incoming
       * authoritative speaking state.
       */
      speaking:
        nextMuted
          ? false
          : isSpeaking,

      muted:
        nextMuted,

      deafened:
        deafened
        ?? current.deafened,

      updatedAt:
        updatedAt
        ?? nowTs()
    }
  );
}

// #endregion
  // #region Speaking Started

  if (isSpeaking) {
    /*
     * Speaking resumed before an existing decay completed.
     */
    this._clearDecayTimer(
      normalizedUserId
    );

    return this.updateState(
      normalizedUserId,
      {
        discordUserId:
          discordUserId
          ?? current.discordUserId,

        speaking: true,

        muted:
          muted
          ?? current.muted,

        deafened:
          deafened
          ?? current.deafened,

        updatedAt:
          updatedAt
          ?? nowTs()
      }
    );
  }

  // #endregion


  // #region Speaking Stopped

  /*
   * Apply non-speaking metadata immediately, but deliberately preserve
   * the current visual speaking state until decay completes.
   */
  this.updateState(
    normalizedUserId,
    {
      discordUserId:
        discordUserId
        ?? current.discordUserId,

      speaking:
        current.speaking,

      muted:
        muted
        ?? current.muted,

      deafened:
        deafened
        ?? current.deafened,

      updatedAt:
        updatedAt
        ?? nowTs()
    }
  );

  /*
   * Remove any previous pending stop timer before creating a new one.
   */
  this._clearDecayTimer(
    normalizedUserId
  );

  /*
   * If already idle, there is nothing further to do.
   */
  const latest =
    this._states.get(
      normalizedUserId
    );

  if (!latest?.speaking) {
    return {
      ...latest
    };
  }

  const normalizedDecay =
    Math.max(
      0,
      Number(decayMs) || 0
    );

  /*
   * Zero decay means transition immediately.
   */
  if (normalizedDecay === 0) {
    return this.updateState(
      normalizedUserId,
      {
        speaking: false,
        updatedAt: nowTs()
      }
    );
  }

  /*
   * Schedule the transition back to idle.
   */
  const timerId =
    globalThis.setTimeout(
      () => {
        /*
         * Remove this timer before applying the state change.
         */
        this._decayTimers.delete(
          normalizedUserId
        );

        const state =
          this._states.get(
            normalizedUserId
          );

        if (!state?.speaking) {
          return;
        }

        this.updateState(
          normalizedUserId,
          {
            speaking: false,
            updatedAt: nowTs()
          }
        );
      },
      normalizedDecay
    );

  this._decayTimers.set(
    normalizedUserId,
    timerId
  );

  return this.getState(
    normalizedUserId
  );

  // #endregion
}

  // #endregion

  // #region Full Synchronization

  /**
   * Replace the entire local portrait state with authoritative state.
   *
   * This operation is intended for:
   * - initial synchronization
   * - late joining clients
   * - client reload/reconnect
   * - explicit full-state synchronization
   *
   * Speaking decay is intentionally not applied here. A full sync represents
   * the authoritative state at the moment it was sent.
   *
   * Accepted formats:
   *
   * Map:
   *   Map<userId, state>
   *
   * Object:
   *   {
   *     userId: state
   *   }
   */
  replaceAll(states = {}) {
    this._clearAllDecayTimers();

    const entries =
      states instanceof Map
        ? Array.from(states.entries())
        : Object.entries(states ?? {});

    const replacement = new Map();

    for (const [userId, state] of entries) {
      const normalizedUserId = normalizeUserId(userId);

      if (!normalizedUserId) {
        continue;
      }

      replacement.set(
        normalizedUserId,
        normalizeState({
          ...DEFAULT_PORTRAIT_STATE,
          ...(state ?? {})
        })
      );
    }

    this._states = replacement;

    this._emit({
      type: PORTRAIT_STATE_EVENTS.REPLACE_ALL,
      states: this.toObject()
    });

    return this.toObject();
  }

  // #endregion

  // #region Reset and Removal

  /**
   * Immediately return every user to idle.
   *
   * Mute/deafen state is preserved because this operation specifically
   * resets speaking state.
   */
  resetSpeakingStates() {
    this._clearAllDecayTimers();

    const changedUserIds = [];

    for (const [userId, state] of this._states.entries()) {
      if (!state.speaking) {
        continue;
      }

      const previousState = { ...state };

      const nextState = {
        ...state,
        speaking: false,
        updatedAt: nowTs()
      };

      this._states.set(
        userId,
        nextState
      );

      changedUserIds.push(userId);

      this._emit({
        type: PORTRAIT_STATE_EVENTS.UPDATE,
        userId,
        state: { ...nextState },
        previousState
      });
    }

    this._emit({
      type: PORTRAIT_STATE_EVENTS.RESET,
      userIds: changedUserIds
    });

    return changedUserIds;
  }

  /**
   * Reset every transient field while retaining each user's store entry.
   */
  resetAllStates() {
    this._clearAllDecayTimers();

    const userIds = Array.from(
      this._states.keys()
    );

    for (const userId of userIds) {
      const previousState = this._states.get(userId);

      const nextState = normalizeState({
        ...DEFAULT_PORTRAIT_STATE,
        discordUserId:
          previousState?.discordUserId
          ?? "",
        updatedAt: nowTs()
      });

      this._states.set(
        userId,
        nextState
      );

      this._emit({
        type: PORTRAIT_STATE_EVENTS.UPDATE,
        userId,
        state: { ...nextState },
        previousState: {
          ...previousState
        }
      });
    }

    this._emit({
      type: PORTRAIT_STATE_EVENTS.RESET,
      userIds
    });

    return userIds;
  }

  /**
   * Remove one user from the runtime state store.
   */
  removeState(userId) {
    const normalizedUserId = normalizeUserId(userId);

    if (!normalizedUserId) {
      return false;
    }

    this._clearDecayTimer(
      normalizedUserId
    );

    const existed = this._states.delete(
      normalizedUserId
    );

    if (existed) {
      this._emit({
        type: PORTRAIT_STATE_EVENTS.REMOVE,
        userId: normalizedUserId
      });
    }

    return existed;
  }

  /**
   * Remove all runtime state.
   */
  clear() {
    this._clearAllDecayTimers();
    this._states.clear();

    this._emit({
      type: PORTRAIT_STATE_EVENTS.REPLACE_ALL,
      states: {}
    });
  }

  // #endregion

  // #region Event Subscription

  /**
   * Subscribe to portrait-state changes.
   *
   * The callback receives one event object.
   *
   * Returns an unsubscribe function.
   */
  subscribe(callback) {
    if (typeof callback !== "function") {
      throw new TypeError(
        "PortraitStateStore.subscribe requires a callback function."
      );
    }

    this._listeners.add(callback);

    return () => {
      this._listeners.delete(callback);
    };
  }

  /**
   * Notify state consumers.
   */
  _emit(event) {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(
          "[FoundryVTT_Max_Headroom] Portrait state listener failed.",
          error
        );
      }
    }
  }

  // #endregion

  // #region Decay Timers

  /**
   * Cancel one user's pending speaking-stop decay.
   */
_clearDecayTimer(userId) {
  const timerId =
    this._decayTimers.get(
      userId
    );

  if (timerId === undefined) {
    return;
  }

  globalThis.clearTimeout(
    timerId
  );

  this._decayTimers.delete(
    userId
  );
}

  /**
   * Cancel all pending speaking-stop decay timers.
   */
_clearAllDecayTimers() {
  for (
    const timerId
    of this._decayTimers.values()
  ) {
    globalThis.clearTimeout(
      timerId
    );
  }

  this._decayTimers.clear();
}

  /**
   * Return whether a user currently has a pending idle transition.
   *
   * Primarily useful for diagnostics and testing.
   */
  hasPendingDecay(userId) {
    const normalizedUserId = normalizeUserId(userId);

    return normalizedUserId
      ? this._decayTimers.has(normalizedUserId)
      : false;
  }

  // #endregion

  // #region Lifecycle

  /**
   * Release timers and subscriptions.
   *
   * Useful if the store is ever replaced during development or hot reload.
   */
  destroy() {
    this._clearAllDecayTimers();
    this._listeners.clear();
    this._states.clear();
  }

  // #endregion
}

// #endregion

// #region Singleton

/**
 * Shared client-side portrait state store.
 *
 * All portrait presentation and future socket synchronization should use
 * this instance rather than creating independent competing stores.
 */
export const portraitState = new PortraitStateStore();

// #endregion