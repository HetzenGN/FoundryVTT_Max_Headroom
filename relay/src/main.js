// relay/src/main.js

// #region Imports

import {
  MESSAGE_SOURCES,
  PROTOCOL_VERSION,
  makeDiscordSpeaking,
  makeRelayReady
} from "../../shared/protocol.js";

import {
  readBootstrap
} from "./bootstrap.js";

import {
  createOpenerTransport
} from "./transport.js";

import {
  startHeartbeat
} from "./heartbeat.js";

import {
  createUserCache
} from "./user-cache.js";

import {
  createSpeakingState
} from "./speaking-state.js";

import {
  EXTRACTION_STRATEGIES,
  createStreamKitAdapter
} from "./streamkit-adapter.js";

import {
  createStreamKitConsoleSource
} from "./streamkit-console-source.js";

// #endregion


// #region Constants

const LOG_PREFIX =
  "[FoundryVTT_Max_Headroom] [StreamKit Relay]";

export const RELAY_SCRIPT_VERSION =
  "0.3.0-dev";

// #endregion


// #region Runtime State

const runtime = {
  started: false,

  bootstrap: null,
  transport: null,
  heartbeat: null,

  userCache: null,
  speakingState: null,
  adapter: null,
  source: null
};

// #endregion


// #region Relay Messages

function sendReady() {
  if (
    !runtime.bootstrap?.valid
    || !runtime.transport
  ) {
    return false;
  }

  const payload = {
    ...makeRelayReady({
      nonce:
        runtime.bootstrap.nonce,

      source:
        MESSAGE_SOURCES.STREAMKIT
    }),

    scriptVersion:
      RELAY_SCRIPT_VERSION
  };

  return runtime.transport.send(
    payload
  );
}


function sendSpeakingSnapshot(
  speakingSnapshot
) {
  if (
    !runtime.bootstrap?.valid
    || !runtime.transport
    || !speakingSnapshot
  ) {
    return false;
  }

  const discordUserId =
    speakingSnapshot
      .discordUserId;

  const user =
    runtime.userCache
      ?.get(discordUserId);

  const payload =
    makeDiscordSpeaking({
      nonce:
        runtime.bootstrap.nonce,

      discordUserId,

      username:
        user?.username,

      nick:
        user?.nick,

      speaking:
        speakingSnapshot
          .speaking,

      muted:
        speakingSnapshot
          .muted,

      deafened:
        speakingSnapshot
          .deafened,

      channelId:
        user?.channelId,

      guildId:
        user?.guildId,

      source:
        MESSAGE_SOURCES.STREAMKIT
    });

  return runtime.transport.send(
    payload
  );
}

// #endregion


// #region Adapter Pipeline

function handleAdapterEvent(event) {
  if (
    !event
    || !runtime.userCache
    || !runtime.speakingState
  ) {
    return false;
  }


  runtime.userCache.upsert(
    event
  );


  if (
    event.kind
    === "voice-state"
  ) {
    /*
     * CREATE and mock snapshots establish metadata
     * without generating an unnecessary speaking
     * packet merely because a user appeared.
     */
    if (
      event.phase
        === "create"
      || event.phase
        === "snapshot"
    ) {
      runtime.speakingState.prime(
        event
      );

      return true;
    }


    /*
     * VOICE_STATE_DELETE is useful as an additional
     * safety stop if a user leaves while marked
     * speaking.
     */
    if (
      event.phase
      === "delete"
    ) {
      const previous =
        runtime.speakingState.get(
          event.discordUserId
        );

      if (
        !previous
        || !previous.speaking
      ) {
        return true;
      }


      const result =
        runtime.speakingState.observe({
          ...event,

          speaking:
            false
        });


      if (!result.emitted) {
        return true;
      }


      return sendSpeakingSnapshot(
        result.state
      );
    }


    /*
     * UPDATE events can carry real mute/deafen
     * changes. Feed them through the normal state
     * transition system so duplicates remain
     * suppressed.
     */
    if (
      event.phase
      === "update"
    ) {
      const result =
        runtime.speakingState.observe(
          event
        );


      if (!result.emitted) {
        return true;
      }


      return sendSpeakingSnapshot(
        result.state
      );
    }


    return true;
  }


  const result =
    runtime.speakingState.observe(
      event
    );


  if (!result.emitted) {
    return false;
  }


  return sendSpeakingSnapshot(
    result.state
  );
}


function handleAdapterError(
  error
) {
  /*
   * For this milestone, extraction errors remain local.
   *
   * RELAY_ERROR transport will be added in the
   * dedicated error-handling increment.
   */
  console.warn(
    LOG_PREFIX,
    "StreamKit adapter error.",
    error
  );
}

// #endregion

function selectExtractionStrategy() {
  if (
    globalThis.location.hostname
    === "streamkit.discord.com"
    && globalThis.location.pathname
      .startsWith(
        "/overlay/voice/"
      )
  ) {
    return EXTRACTION_STRATEGIES
      .EVENT_INTERCEPTION;
  }

  return EXTRACTION_STRATEGIES
    .MOCK;
}

// #region Debug Fake Inputs

function makeFakeUser(
  discordUserId,
  options = {}
) {
  return {
    id:
      discordUserId,

    username:
      options.username,

    nick:
      options.nick
  };
}


function makeFakeVoice(
  options = {}
) {
  return {
    muted:
      options.muted,

    deafened:
      options.deafened,

    channelId:
      options.channelId,

    guildId:
      options.guildId
  };
}


function emitFakeUser(
  discordUserId,
  options = {}
) {
  return (
    runtime.adapter
      ?.ingestRawObservation({
        type:
          "voice-state",

        user:
          makeFakeUser(
            discordUserId,
            options
          ),

        voice:
          makeFakeVoice(
            options
          )
      })
    ?? false
  );
}


function emitFakeSpeaking(
  discordUserId,
  speaking,
  options = {}
) {
  return (
    runtime.adapter
      ?.ingestRawObservation({
        type:
          "speaking",

        user:
          makeFakeUser(
            discordUserId,
            options
          ),

        voice:
          makeFakeVoice(
            options
          ),

        speaking
      })
    ?? false
  );
}


function emitFakeMute(
  discordUserId,
  muted,
  options = {}
) {
  return (
    runtime.adapter
      ?.ingestRawObservation({
        type:
          "mute",

        user:
          makeFakeUser(
            discordUserId,
            options
          ),

        voice:
          makeFakeVoice(
            options
          ),

        muted
      })
    ?? false
  );
}


function emitFakeDeafen(
  discordUserId,
  deafened,
  options = {}
) {
  return (
    runtime.adapter
      ?.ingestRawObservation({
        type:
          "deafen",

        user:
          makeFakeUser(
            discordUserId,
            options
          ),

        voice:
          makeFakeVoice(
            options
          ),

        deafened
      })
    ?? false
  );
}


function emitMalformedFakeEvent() {
  return (
    runtime.adapter
      ?.ingestRawObservation({
        type:
          "speaking",

        user: {
          /*
           * Deliberately invalid:
           * Discord IDs must be strings.
           */
          id:
            123456789012345678
        },

        speaking:
          "yes"
      })
    ?? false
  );
}

// #endregion


// #region Diagnostics

function getBootstrapState() {
  const bootstrap =
    runtime.bootstrap;

  if (!bootstrap) {
    return null;
  }

  return {
    valid:
      bootstrap.valid,

    noncePresent:
      Boolean(
        bootstrap.nonce
      ),

    protocol:
      bootstrap.protocol,

    openerOrigin:
      bootstrap.openerOrigin,

    errors:
      bootstrap.errors.map(
        (error) => ({ ...error })
      )
  };
}


function getRuntimeState() {
  return {
    started:
      runtime.started,

    protocolVersion:
      PROTOCOL_VERSION,

    scriptVersion:
      RELAY_SCRIPT_VERSION,

    bootstrap:
      getBootstrapState(),

    transport:
      runtime.transport
        ?.getState()
        ?? null,

    heartbeat:
      runtime.heartbeat
        ?.getState()
        ?? null,

    extraction:
      runtime.adapter
        ?.getState()
        ?? null,

    source:
      runtime.source
        ?.getState()
        ?? null,

    users:
      runtime.userCache
        ?.dump()
        ?? {},

    speaking:
      runtime.speakingState
        ?.dump()
        ?? null
  };
}


function installDebugApi() {
  globalThis
    .__maxHeadroomStreamKitRelayDebug =
    Object.freeze({
      emitFakeUser,
      emitFakeSpeaking,
      emitFakeMute,
      emitFakeDeafen,
      emitMalformedFakeEvent,

      dumpUsers() {
        return (
          runtime.userCache
            ?.dump()
          ?? {}
        );
      },

      dumpState() {
        return (
          runtime.speakingState
            ?.dump()
          ?? null
        );
      },

      sendReady,

      sendHeartbeat() {
        return (
          runtime.heartbeat
            ?.sendHeartbeat()
          ?? false
        );
      },

      getTransportState() {
        return (
          runtime.transport
            ?.getState()
          ?? null
        );
      },

      getExtractionStrategy() {
        return (
          runtime.adapter
            ?.getStrategy()
          ?? EXTRACTION_STRATEGIES
            .UNAVAILABLE
        );
      },

      getBootstrapState,
      getRuntimeState
    });
}

// #endregion


// #region Startup

function startRelay() {
  runtime.bootstrap =
    readBootstrap();

  installDebugApi();


  if (
    !runtime.bootstrap.valid
  ) {
    console.error(
      LOG_PREFIX,
      "Bootstrap rejected.",
      runtime.bootstrap.errors
    );

    return false;
  }


  if (!globalThis.opener) {
    console.error(
      LOG_PREFIX,
      "Foundry opener window is unavailable."
    );

    return false;
  }


  runtime.transport =
    createOpenerTransport({
      targetOrigin:
        runtime.bootstrap
          .openerOrigin,

      opener:
        globalThis.opener
    });


  const transportState =
    runtime.transport.getState();


  if (
    !transportState.openerAvailable
    || transportState.openerClosed
  ) {
    console.error(
      LOG_PREFIX,
      "Foundry opener window is unavailable or closed."
    );

    return false;
  }


  runtime.userCache =
    createUserCache();

  runtime.speakingState =
    createSpeakingState();

  const extractionStrategy =
    selectExtractionStrategy();


  runtime.adapter =
    createStreamKitAdapter({
      strategy:
        extractionStrategy,

      onEvent:
        handleAdapterEvent,

      onError:
        handleAdapterError
    });


  if (
    extractionStrategy
    === EXTRACTION_STRATEGIES
      .EVENT_INTERCEPTION
  ) {
    runtime.source =
      createStreamKitConsoleSource({
        pageWindow:
          globalThis,

        onRawObservation(
          rawObservation
        ) {
          runtime.adapter
            .ingestRawObservation(
              rawObservation
            );
        },

        onError:
          handleAdapterError
      });


    if (
      !runtime.source.start()
    ) {
      console.error(
        LOG_PREFIX,
        "StreamKit event interception could not be started."
      );

      return false;
    }
  }


  runtime.started = true;


  if (!sendReady()) {
    console.error(
      LOG_PREFIX,
      "Unable to send relay-ready."
    );

    runtime.started = false;

    return false;
  }


  runtime.heartbeat =
    startHeartbeat({
      nonce:
        runtime.bootstrap.nonce,

      transport:
        runtime.transport,

      scriptVersion:
        RELAY_SCRIPT_VERSION
    });


  console.info(
    LOG_PREFIX,
    `Relay started. Protocol ${PROTOCOL_VERSION}, script ${RELAY_SCRIPT_VERSION}, extraction ${runtime.adapter.getStrategy()}.`
  );

  return true;
}

// #endregion


// #region Entrypoint

startRelay();

// #endregion