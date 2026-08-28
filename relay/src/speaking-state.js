// relay/src/speaking-state.js

// #region Helpers

function normalizeDiscordUserId(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}


function makeInitialState(
  discordUserId
) {
  return {
    discordUserId,

    speaking:
      false,

    muted:
      false,

    deafened:
      false,

    speakingObserved:
      false,

    mutedObserved:
      false,

    deafenedObserved:
      false,

    updatedAt:
      0
  };
}


function cloneState(state) {
  return state
    ? { ...state }
    : null;
}

// #endregion


// #region Speaking State

export function createSpeakingState() {
  const states =
    new Map();

  let emittedCount = 0;
  let suppressedCount = 0;


  function getOrCreate(
    discordUserId
  ) {
    return (
      states.get(discordUserId)
      ?? makeInitialState(
        discordUserId
      )
    );
  }


  /**
   * Update cached voice metadata without emitting
   * a speaking transition.
   *
   * This is useful when StreamKit first exposes a
   * user's general voice state before any speaking
   * activity occurs.
   */
  function prime(observation) {
    const discordUserId =
      normalizeDiscordUserId(
        observation?.discordUserId
      );

    if (!discordUserId) {
      return null;
    }

    const state = {
      ...getOrCreate(
        discordUserId
      )
    };

    if (
      typeof observation.muted
      === "boolean"
    ) {
      state.muted =
        observation.muted;

      state.mutedObserved =
        true;
    }

    if (
      typeof observation.deafened
      === "boolean"
    ) {
      state.deafened =
        observation.deafened;

      state.deafenedObserved =
        true;
    }

    state.updatedAt =
      Date.now();

    states.set(
      discordUserId,
      state
    );

    return cloneState(state);
  }


  /**
   * Observe a speaking/mute/deafen event.
   *
   * Returns emitted=true only when a meaningful
   * state transition occurred.
   */
  function observe(observation) {
    const discordUserId =
      normalizeDiscordUserId(
        observation?.discordUserId
      );

    if (!discordUserId) {
      return {
        emitted: false,
        reason:
          "invalid-user-id",
        state: null
      };
    }

    const previous =
      getOrCreate(
        discordUserId
      );

    const next = {
      ...previous
    };

    let meaningfulChange =
      false;

    let observedStateField =
      false;


    if (
      typeof observation.speaking
      === "boolean"
    ) {
      observedStateField =
        true;

      if (
        !previous.speakingObserved
        || previous.speaking
          !== observation.speaking
      ) {
        meaningfulChange =
          true;
      }

      next.speaking =
        observation.speaking;

      next.speakingObserved =
        true;
    }


    if (
      typeof observation.muted
      === "boolean"
    ) {
      observedStateField =
        true;

      if (
        !previous.mutedObserved
        || previous.muted
          !== observation.muted
      ) {
        meaningfulChange =
          true;
      }

      next.muted =
        observation.muted;

      next.mutedObserved =
        true;
    }


    if (
      typeof observation.deafened
      === "boolean"
    ) {
      observedStateField =
        true;

      if (
        !previous.deafenedObserved
        || previous.deafened
          !== observation.deafened
      ) {
        meaningfulChange =
          true;
      }

      next.deafened =
        observation.deafened;

      next.deafenedObserved =
        true;
    }


    if (!observedStateField) {
      return {
        emitted: false,
        reason:
          "no-state-fields",
        state:
          cloneState(previous)
      };
    }


    next.updatedAt =
      Date.now();

    states.set(
      discordUserId,
      next
    );


    if (!meaningfulChange) {
      suppressedCount += 1;

      return {
        emitted: false,
        reason:
          "duplicate",
        state:
          cloneState(next)
      };
    }


    emittedCount += 1;

    return {
      emitted: true,
      reason:
        "transition",
      state:
        cloneState(next)
    };
  }


  function get(discordUserId) {
    const normalized =
      normalizeDiscordUserId(
        discordUserId
      );

    return cloneState(
      states.get(normalized)
    );
  }


  function dump() {
    const users = {};

    for (
      const [
        discordUserId,
        state
      ]
      of states.entries()
    ) {
      users[discordUserId] =
        cloneState(state);
    }

    return {
      emittedCount,
      suppressedCount,
      users
    };
  }


  function clear() {
    states.clear();

    emittedCount = 0;
    suppressedCount = 0;
  }


  return Object.freeze({
    prime,
    observe,
    get,
    dump,
    clear
  });
}

// #endregion