// scripts/relay/discord-user-directory.js

// #region Helpers

function normalizeDiscordUserId(
  value
) {
  if (
    typeof value !== "string"
    || !/^\d+$/.test(
      value.trim()
    )
  ) {
    return "";
  }

  return value.trim();
}


function normalizeOptionalText(
  value
) {
  if (
    value === undefined
    || value === null
  ) {
    return "";
  }

  return String(value).trim();
}


function makeDisplayName({
  discordUserId,
  username,
  nick
}) {
  if (
    nick
    && username
    && nick !== username
  ) {
    return `${nick} (${username})`;
  }

  if (nick) {
    return nick;
  }

  if (username) {
    return username;
  }

  const suffix =
    discordUserId.slice(-6);

  return `Discord User …${suffix}`;
}


function cloneEntry(
  entry
) {
  return entry
    ? { ...entry }
    : null;
}

// #endregion


// #region Discord User Directory

class DiscordUserDirectory {
  constructor() {
    this._users =
      new Map();
  }


  /**
   * Record one observed Discord voice user.
   *
   * VOICE_STATE_DELETE deliberately keeps the user's
   * friendly metadata while marking them absent.
   */
  record(observation) {
    const discordUserId =
      normalizeDiscordUserId(
        observation?.discordUserId
      );

    if (!discordUserId) {
      return null;
    }


    const previous =
      this._users.get(
        discordUserId
      )
      ?? {
        discordUserId,

        username:
          "",

        nick:
          "",

        guildId:
          "",

        channelId:
          "",

        present:
          false,

        firstSeen:
          Date.now(),

        lastSeen:
          0,

        lastEventName:
          ""
      };


    const username =
      normalizeOptionalText(
        observation.username
      )
      || previous.username;


    const nick =
      normalizeOptionalText(
        observation.nick
      )
      || previous.nick;


    const guildId =
      normalizeDiscordUserId(
        observation.guildId
      )
      || previous.guildId;


    const channelId =
      normalizeDiscordUserId(
        observation.channelId
      )
      || previous.channelId;


    const lastSeen =
      Number.isFinite(
        Number(
          observation.observedAt
        )
      )
        ? Number(
            observation.observedAt
          )
        : Date.now();


    const next = {
      discordUserId,

      username,
      nick,
      guildId,
      channelId,

      present:
        Boolean(
          observation.present
        ),

      firstSeen:
        previous.firstSeen,

      lastSeen,

      lastEventName:
        normalizeOptionalText(
          observation.eventName
        )
    };


    next.displayName =
      makeDisplayName(
        next
      );


    this._users.set(
      discordUserId,
      next
    );


    return cloneEntry(
      next
    );
  }


  get(
    discordUserId
  ) {
    const normalized =
      normalizeDiscordUserId(
        discordUserId
      );

    return cloneEntry(
      this._users.get(
        normalized
      )
    );
  }


  list() {
    return Array.from(
      this._users.values()
    )
      .map(
        cloneEntry
      )
      .sort(
        (a, b) => {
          /*
           * Currently-present users appear first.
           */
          if (
            a.present
            !== b.present
          ) {
            return a.present
              ? -1
              : 1;
          }

          return String(
            a.displayName
          ).localeCompare(
            String(
              b.displayName
            )
          );
        }
      );
  }


  clear() {
    this._users.clear();
  }


  get size() {
    return this._users.size;
  }
}

// #endregion


// #region Singleton

export const discordUserDirectory =
  new DiscordUserDirectory();

// #endregion