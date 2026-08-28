// relay/src/user-cache.js

// #region Helpers

function normalizeDiscordUserId(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}


function normalizeOptionalText(value) {
  if (
    value === undefined
    || value === null
  ) {
    return undefined;
  }

  const text =
    String(value).trim();

  return text || undefined;
}


function cloneUser(user) {
  return user
    ? { ...user }
    : null;
}

// #endregion


// #region User Cache

export function createUserCache() {
  const users =
    new Map();


  function upsert(observation) {
    const discordUserId =
      normalizeDiscordUserId(
        observation?.discordUserId
      );

    if (!discordUserId) {
      return null;
    }

    const previous =
      users.get(discordUserId)
      ?? {
        discordUserId,

        username:
          undefined,

        nick:
          undefined,

        muted:
          false,

        deafened:
          false,

        channelId:
          undefined,

        guildId:
          undefined,

        lastSeen:
          0
      };

    const next = {
      ...previous,

      discordUserId,

      lastSeen:
        Date.now()
    };

    if (
      observation.username
      !== undefined
    ) {
      next.username =
        normalizeOptionalText(
          observation.username
        );
    }

    if (
      observation.nick
      !== undefined
    ) {
      next.nick =
        normalizeOptionalText(
          observation.nick
        );
    }

    if (
      typeof observation.muted
      === "boolean"
    ) {
      next.muted =
        observation.muted;
    }

    if (
      typeof observation.deafened
      === "boolean"
    ) {
      next.deafened =
        observation.deafened;
    }

    if (
      observation.channelId
      !== undefined
    ) {
      next.channelId =
        normalizeOptionalText(
          observation.channelId
        );
    }

    if (
      observation.guildId
      !== undefined
    ) {
      next.guildId =
        normalizeOptionalText(
          observation.guildId
        );
    }

    users.set(
      discordUserId,
      next
    );

    return cloneUser(next);
  }


  function get(discordUserId) {
    const normalized =
      normalizeDiscordUserId(
        discordUserId
      );

    return cloneUser(
      users.get(normalized)
    );
  }


  function dump() {
    const result = {};

    for (
      const [
        discordUserId,
        user
      ]
      of users.entries()
    ) {
      result[discordUserId] =
        cloneUser(user);
    }

    return result;
  }


  function clear() {
    users.clear();
  }


  return Object.freeze({
    upsert,
    get,
    dump,
    clear
  });
}

// #endregion