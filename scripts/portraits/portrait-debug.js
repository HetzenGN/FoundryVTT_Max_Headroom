// scripts/portraits/portrait-debug.js

// #region Imports

import {
  MODULE_ID
} from "../../shared/protocol.js";

import {
  findUserByDiscordId,
  getReactivePortraitConfig
} from "./portrait-flags.js";

import {
  portraitState
} from "./portrait-state.js";

import {
  portraitBar
} from "./portrait-bar.js";

// #endregion


// #region Constants

const LOG_PREFIX = "[FoundryVTT_Max_Headroom]";

// #endregion


// #region User Resolution

/**
 * Resolve a Foundry User from a convenient debug reference.
 *
 * Accepted values:
 *
 * - Foundry User document
 * - Foundry User ID
 * - exact Foundry User name
 * - configured Discord User ID
 *
 * Returns null if no matching user is found.
 */
function resolveUser(userReference) {
  if (!userReference) {
    return null;
  }

  /*
   * Already looks like a Foundry User document.
   */
  if (
    typeof userReference === "object"
    && userReference.id
    && typeof userReference.getFlag === "function"
  ) {
    return userReference;
  }

  const value =
    String(userReference).trim();

  if (!value) {
    return null;
  }

  /*
   * Foundry User ID.
   */
  const byId =
    game.users.get(value);

  if (byId) {
    return byId;
  }

  /*
   * Exact Foundry User name.
   */
  const lowered =
    value.toLowerCase();

  const byName =
    game.users.find(
      (user) =>
        String(user.name ?? "")
          .toLowerCase()
          === lowered
    );

  if (byName) {
    return byName;
  }

  /*
   * Configured Discord User ID.
   */
  return findUserByDiscordId(value);
}

/**
 * Resolve a User or throw a useful debug error.
 */
function requireUser(userReference) {
  const user =
    resolveUser(userReference);

  if (!user) {
    throw new Error(
      `${LOG_PREFIX} Could not resolve Foundry User from "${String(userReference)}".`
    );
  }

  return user;
}

// #endregion


// #region State Inspection

/**
 * Return the complete current portrait runtime state.
 *
 * Intended for browser-console diagnostics.
 */
export function getPortraitDebugState() {
  return portraitState.toObject();
}

/**
 * Return the current runtime state and persistent reactive configuration
 * for one Foundry User.
 */
export function inspectPortraitUser(userReference) {
  const user =
    requireUser(userReference);

  return {
    user: {
      id: user.id,
      name: user.name
    },

    config:
      getReactivePortraitConfig(user),

    state:
      portraitState.getState(user.id),

    pendingDecay:
      portraitState.hasPendingDecay(user.id)
  };
}

// #endregion


// #region Speaking Simulation

/**
 * Simulate speaking state for one configured Foundry User.
 *
 * Examples:
 *
 * simulatePortraitSpeaking("Alice", true)
 * simulatePortraitSpeaking("Alice", false)
 *
 * The false transition uses normal speech decay unless decayMs is
 * explicitly overridden.
 */
export function simulatePortraitSpeaking(
  userReference,
  speaking = true,
  {
    muted,
    deafened,
    decayMs
  } = {}
) {
  const user =
    requireUser(userReference);

  const config =
    getReactivePortraitConfig(user);

  const current =
    portraitState.getState(user.id);

  portraitState.ensureState(
    user.id,
    {
      discordUserId:
        config.discordUserId
    }
  );

  const options = {};

  if (decayMs !== undefined) {
    options.decayMs = decayMs;
  }

  const state =
    portraitState.setSpeakingState(
      user.id,
      {
        discordUserId:
          config.discordUserId,

        speaking:
          Boolean(speaking),

        muted:
          muted
          ?? current?.muted
          ?? false,

        deafened:
          deafened
          ?? current?.deafened
          ?? false
      },
      options
    );

  console.debug(
    `${LOG_PREFIX} Simulated portrait speaking state:`,
    {
      userId: user.id,
      userName: user.name,
      speaking: Boolean(speaking),
      state
    }
  );

  return state;
}

/**
 * Toggle one user's current speaking state.
 */
export function togglePortraitSpeaking(
  userReference,
  options = {}
) {
  const user =
    requireUser(userReference);

  const current =
    portraitState.getState(user.id);

  const nextSpeaking =
    !Boolean(current?.speaking);

  return simulatePortraitSpeaking(
    user,
    nextSpeaking,
    options
  );
}

/**
 * Mark multiple users as speaking simultaneously.
 *
 * Existing speakers which are not listed are left unchanged.
 */
export function simulateSimultaneousSpeakers(
  userReferences = []
) {
  if (!Array.isArray(userReferences)) {
    throw new TypeError(
      `${LOG_PREFIX} simulateSimultaneousSpeakers requires an array.`
    );
  }

  const results = [];

  for (const userReference of userReferences) {
    const user =
      requireUser(userReference);

    const state =
      simulatePortraitSpeaking(
        user,
        true
      );

    results.push({
      userId: user.id,
      userName: user.name,
      state
    });
  }

  return results;
}

// #endregion


// #region Mute and Deafen Simulation

/**
 * Set or clear one user's muted state without altering their current
 * speaking state.
 */
export function simulatePortraitMuted(
  userReference,
  muted = true
) {
  const user =
    requireUser(userReference);

  const config =
    getReactivePortraitConfig(user);

  portraitState.ensureState(
    user.id,
    {
      discordUserId:
        config.discordUserId
    }
  );

  return portraitState.updateState(
    user.id,
    {
      discordUserId:
        config.discordUserId,

      muted:
        Boolean(muted)
    }
  );
}

/**
 * Toggle one user's muted state.
 */
export function togglePortraitMuted(
  userReference
) {
  const user =
    requireUser(userReference);

  const current =
    portraitState.getState(user.id);

  return simulatePortraitMuted(
    user,
    !Boolean(current?.muted)
  );
}

/**
 * Set or clear one user's deafened state without altering their current
 * speaking state.
 */
export function simulatePortraitDeafened(
  userReference,
  deafened = true
) {
  const user =
    requireUser(userReference);

  const config =
    getReactivePortraitConfig(user);

  portraitState.ensureState(
    user.id,
    {
      discordUserId:
        config.discordUserId
    }
  );

  return portraitState.updateState(
    user.id,
    {
      discordUserId:
        config.discordUserId,

      deafened:
        Boolean(deafened)
    }
  );
}

/**
 * Toggle one user's deafened state.
 */
export function togglePortraitDeafened(
  userReference
) {
  const user =
    requireUser(userReference);

  const current =
    portraitState.getState(user.id);

  return simulatePortraitDeafened(
    user,
    !Boolean(current?.deafened)
  );
}

// #endregion


// #region Reset Utilities

/**
 * Immediately return all portraits to their idle speaking state.
 *
 * Mute/deafen values are preserved.
 */
export function resetPortraitSpeaking() {
  return portraitState.resetSpeakingStates();
}

/**
 * Reset all transient portrait state.
 *
 * Speaking, muted, and deafened states are cleared.
 */
export function resetPortraitStates() {
  return portraitState.resetAllStates();
}

/**
 * Completely clear the client-side portrait state store.
 */
export function clearPortraitStates() {
  portraitState.clear();
}

// #endregion


// #region Portrait Bar Utilities

/**
 * Fully re-render the Portrait Bar.
 *
 * Use this after modifying User flags or layout settings.
 */
export async function refreshPortraitBar() {
  return portraitBar.refresh();
}

/**
 * Patch all currently rendered portrait tiles without rebuilding the
 * Handlebars application.
 */
export function patchPortraitBar() {
  portraitBar.patchAll();
}

// #endregion


// #region Debug API

/**
 * Public-facing development/debug methods.
 *
 * scripts/main.js can spread this object into the module API.
 *
 * Example:
 *
 * game.modules.get(MODULE_ID).api.simulatePortraitSpeaking("Alice", true)
 */
export const portraitDebugApi = Object.freeze({
  getPortraitDebugState,
  inspectPortraitUser,

  simulatePortraitSpeaking,
  togglePortraitSpeaking,
  simulateSimultaneousSpeakers,

  simulatePortraitMuted,
  togglePortraitMuted,

  simulatePortraitDeafened,
  togglePortraitDeafened,

  resetPortraitSpeaking,
  resetPortraitStates,
  clearPortraitStates,

  refreshPortraitBar,
  patchPortraitBar
});

// #endregion