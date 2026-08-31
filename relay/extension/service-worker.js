// relay/extension/service-worker.js

// #region Constants

const MODULE_ID =
  "foundryvtt-max-headroom";

const STREAMKIT_MESSAGE_TYPE =
  "MAX_HEADROOM_STREAMKIT_SPEAKING";

const STREAMKIT_USER_MESSAGE_TYPE =
  "MAX_HEADROOM_STREAMKIT_USER";

const STORAGE_KEY =
  "pairedFoundryTab";

const STREAMKIT_ORIGIN =
  "https://streamkit.discord.com";

const STREAMKIT_PATH_PREFIX =
  "/overlay/voice/";

const LOG_PREFIX =
  "[Max Headroom extension]";

const STREAMKIT_HEALTH_MESSAGE_TYPE =
  "MAX_HEADROOM_STREAMKIT_HEALTH";


const EXTENSION_VERSION =
  chrome.runtime
    .getManifest()
    .version;

// #endregion


// #region URL Helpers

function getOrigin(
  rawUrl
) {
  try {
    return new URL(
      rawUrl
    ).origin;
  } catch {
    return "";
  }
}


function isStreamKitUrl(
  rawUrl
) {
  try {
    const url =
      new URL(rawUrl);

    return (
      url.origin
        === STREAMKIT_ORIGIN

      && url.pathname
        .startsWith(
          STREAMKIT_PATH_PREFIX
        )
    );

  } catch {
    return false;
  }
}

function getStreamKitChannelId(
  rawUrl
) {
  try {
    const url =
      new URL(rawUrl);

    const match =
      url.pathname.match(
        /^\/overlay\/voice\/[^/]+\/([^/]+)/
      );

    const channelId =
      String(
        match?.[1]
        ?? ""
      ).trim();

    return /^\d+$/.test(
      channelId
    )
      ? channelId
      : "";

  } catch {
    return "";
  }
}

// #endregion


// #region Payload Validation

function isValidSpeakingPayload(
  payload
) {
  if (
    !payload
    || typeof payload
      !== "object"
  ) {
    return false;
  }


  if (
    payload.eventName
      !== "SPEAKING_START"

    && payload.eventName
      !== "SPEAKING_STOP"
  ) {
    return false;
  }


  if (
    typeof payload.discordUserId
      !== "string"

    || !/^\d+$/.test(
      payload.discordUserId
    )
  ) {
    return false;
  }


  if (
    typeof payload.channelId
      !== "string"

    || !/^\d+$/.test(
      payload.channelId
    )
  ) {
    return false;
  }


  if (
    typeof payload.speaking
      !== "boolean"
  ) {
    return false;
  }


  if (
    !Number.isFinite(
      payload.observedAt
    )
  ) {
    return false;
  }


  return true;
}

function isValidDiscordUserPayload(
  payload
) {
  const acceptedEvents =
    new Set([
      "VOICE_STATE_CREATE",
      "VOICE_STATE_UPDATE",
      "VOICE_STATE_DELETE"
    ]);


  return Boolean(
    payload
    && typeof payload
      === "object"

    && acceptedEvents.has(
      payload.eventName
    )

    && typeof payload.discordUserId
      === "string"

    && /^\d+$/.test(
      payload.discordUserId
    )

    && typeof payload.guildId
      === "string"

    && /^\d+$/.test(
      payload.guildId
    )

    && typeof payload.channelId
      === "string"

    && /^\d+$/.test(
      payload.channelId
    )

    && typeof payload.present
      === "boolean"

    && typeof payload.muted
      === "boolean"

    && Number.isFinite(
      payload.observedAt
    )
  );
}

function isValidRelayHealthPayload(
  payload
) {
  return Boolean(
    payload
    && typeof payload
      === "object"

    && (
      payload.state
        === "ready"

      || payload.state
        === "heartbeat"

      || payload.state
        === "disconnected"
    )

    && typeof payload.channelId
      === "string"

    && /^\d+$/.test(
      payload.channelId
    )

    && Number.isFinite(
      payload.observedAt
    )
  );
}

// #endregion


// #region Foundry Inspection

async function inspectFoundryTab(
  tabId
) {
  const results =
    await chrome.scripting
      .executeScript({
        target: {
          tabId
        },

        world:
          "MAIN",

        func:
          (moduleId) => {
            const module =
              globalThis.game
                ?.modules
                ?.get(
                  moduleId
                );


            return {
              foundryAvailable:
                Boolean(
                  globalThis.game
                ),

              modulePresent:
                Boolean(module),

              moduleActive:
                Boolean(
                  module?.active
                ),

              ingressAvailable:
                typeof module
                  ?.api
                  ?.receiveExtensionSpeakingEvent
                  === "function",

              userDirectoryIngressAvailable:
                typeof module
                  ?.api
                  ?.receiveExtensionDiscordUserEvent
                  === "function",

              relayHealthIngressAvailable:
                typeof module
                  ?.api
                  ?.receiveExtensionRelayHealth
                  === "function",

              href:
                globalThis.location.href
            };
          },

        args: [
          MODULE_ID
        ]
      });


  return (
    results?.[0]?.result
    ?? null
  );
}

// #endregion


// #region Pairing

async function pairFoundryTab(
  tab
) {
  const tabId =
    tab?.id;


  if (
    !Number.isInteger(
      tabId
    )
  ) {
    console.warn(
      LOG_PREFIX,
      "The active tab has no usable tab ID."
    );

    return false;
  }


  let inspection;


  try {
    inspection =
      await inspectFoundryTab(
        tabId
      );

  } catch (error) {
    console.warn(
      LOG_PREFIX,
      "Unable to inspect the active tab.",
      error
    );

    return false;
  }


if (
  !inspection
  || !inspection.foundryAvailable
  || !inspection.modulePresent
  || !inspection.moduleActive
  || !inspection.ingressAvailable
  || !inspection.userDirectoryIngressAvailable
  || !inspection.relayHealthIngressAvailable
) {
    console.warn(
      LOG_PREFIX,
      "The active tab is not a ready FoundryVTT Max Headroom game.",
      inspection
    );

    return false;
  }


  const pairedFoundryTab = {
    tabId,

    origin:
      getOrigin(
        tab.url
        ?? inspection.href
      ),

    pairedAt:
      Date.now()
  };


  await chrome.storage
    .session
    .set({
      [STORAGE_KEY]:
        pairedFoundryTab
    });


  await chrome.action
    .setBadgeText({
      tabId,

      text:
        "F"
    });


  console.info(
    LOG_PREFIX,
    "Paired Foundry tab.",
    pairedFoundryTab
  );


  return true;
}


chrome.action
  .onClicked
  .addListener(
    (tab) => {
      pairFoundryTab(
        tab
      ).catch(
        (error) => {
          console.error(
            LOG_PREFIX,
            "Unable to pair active tab.",
            error
          );
        }
      );
    }
  );

// #endregion


// #region Paired Tab State

async function getPairedFoundryTab() {
  const stored =
    await chrome.storage
      .session
      .get(
        STORAGE_KEY
      );


  return (
    stored[STORAGE_KEY]
    ?? null
  );
}


async function clearPairedFoundryTab() {
  await chrome.storage
    .session
    .remove(
      STORAGE_KEY
    );
}

// #endregion


// #region Foundry Delivery

async function deliverToFoundry(
  tabId,
  methodName,
  payload
) {
  const results =
    await chrome.scripting
      .executeScript({
        target: {
          tabId
        },

        world:
          "MAIN",

        func:
          (
            moduleId,
            requestedMethod,
            deliveredPayload
          ) => {
            const module =
              globalThis.game
                ?.modules
                ?.get(
                  moduleId
                );


            const receive =
              module
                ?.api
                ?.[requestedMethod];


            if (
              typeof receive
              !== "function"
            ) {
              return {
                ok: false,

                error:
                  "foundry-ingress-unavailable",

                method:
                  requestedMethod
              };
            }


            try {
              return (
                receive(
                  deliveredPayload
                )

                ?? {
                  ok: true
                }
              );

            } catch (error) {
              return {
                ok: false,

                error:
                  "foundry-ingress-threw",

                message:
                  error instanceof Error
                    ? error.message
                    : String(error)
              };
            }
          },

        args: [
          MODULE_ID,
          methodName,
          payload
        ]
      });


  return (
    results?.[0]?.result

    ?? {
      ok: false,
      error:
        "foundry-returned-no-result"
    }
  );
}

// #endregion


// #region StreamKit Routing

async function routeSpeakingEvent(
  message,
  sender
) {
  const senderUrl =
    sender?.url
    ?? sender?.tab?.url
    ?? "";


  /*
   * Extension messages are accepted only from our
   * content script running on the StreamKit Voice
   * overlay.
   */
  if (
    !isStreamKitUrl(
      senderUrl
    )
  ) {
    return {
      ok: false,
      error:
        "invalid-streamkit-sender"
    };
  }

  const senderChannelId =
  getStreamKitChannelId(
    senderUrl
  );


if (!senderChannelId) {
  return {
    ok: false,
    error:
      "streamkit-channel-unavailable"
  };
}

  if (
    !isValidSpeakingPayload(
      message.payload
    )
  ) {
    return {
      ok: false,
      error:
        "invalid-speaking-payload"
    };
  }

  if (
  message.payload.channelId
  !== senderChannelId
) {
  return {
    ok: false,
    error:
      "streamkit-channel-mismatch"
  };
}


  const paired =
    await getPairedFoundryTab();


  if (
    !paired
    || !Number.isInteger(
      paired.tabId
    )
  ) {
    return {
      ok: false,
      error:
        "no-paired-foundry-tab"
    };
  }


  try {
    const result =
      await deliverToFoundry(
        paired.tabId,
        "receiveExtensionSpeakingEvent",
        message.payload
      );

    if (!result?.ok) {
      console.warn(
        LOG_PREFIX,
        "Foundry rejected the extension speaking event.",
        result
      );
    }


    return result;

  } catch (error) {
    console.warn(
      LOG_PREFIX,
      "Unable to deliver StreamKit event to paired Foundry tab.",
      error
    );


    return {
      ok: false,
      error:
        "foundry-delivery-failed"
    };
  }
}

// #endregion

// #region Discord User Routing

async function routeDiscordUserEvent(
  message,
  sender
) {
  const senderUrl =
    sender?.url
    ?? sender?.tab?.url
    ?? "";


  if (
    !isStreamKitUrl(
      senderUrl
    )
  ) {
    return {
      ok: false,
      error:
        "invalid-streamkit-sender"
    };
  }


  const senderChannelId =
    getStreamKitChannelId(
      senderUrl
    );


  if (!senderChannelId) {
    return {
      ok: false,
      error:
        "streamkit-channel-unavailable"
    };
  }


  if (
    !isValidDiscordUserPayload(
      message.payload
    )
  ) {
    return {
      ok: false,
      error:
        "invalid-discord-user-payload"
    };
  }


  if (
    message.payload.channelId
    !== senderChannelId
  ) {
    return {
      ok: false,
      error:
        "streamkit-channel-mismatch"
    };
  }


  const paired =
    await getPairedFoundryTab();


  if (
    !paired
    || !Number.isInteger(
      paired.tabId
    )
  ) {
    return {
      ok: false,
      error:
        "no-paired-foundry-tab"
    };
  }


  return deliverToFoundry(
    paired.tabId,
    "receiveExtensionDiscordUserEvent",
    message.payload
  );
}

// #endregion

// #region Relay Health Routing

async function routeRelayHealth(
  message,
  sender
) {
  const senderUrl =
    sender?.url
    ?? sender?.tab?.url
    ?? "";


  if (
    !isStreamKitUrl(
      senderUrl
    )
  ) {
    return {
      ok: false,
      error:
        "invalid-streamkit-sender"
    };
  }


  const senderChannelId =
    getStreamKitChannelId(
      senderUrl
    );


  if (!senderChannelId) {
    return {
      ok: false,
      error:
        "streamkit-channel-unavailable"
    };
  }


  if (
    !isValidRelayHealthPayload(
      message.payload
    )
  ) {
    return {
      ok: false,
      error:
        "invalid-relay-health-payload"
    };
  }


  if (
    message.payload.channelId
    !== senderChannelId
  ) {
    return {
      ok: false,
      error:
        "streamkit-channel-mismatch"
    };
  }


  const paired =
    await getPairedFoundryTab();


  if (
    !paired
    || !Number.isInteger(
      paired.tabId
    )
  ) {
    return {
      ok: false,
      error:
        "no-paired-foundry-tab"
    };
  }


  return deliverToFoundry(
    paired.tabId,
    "receiveExtensionRelayHealth",
    {
      ...message.payload,

      extensionVersion:
        EXTENSION_VERSION
    }
  );
}

// #endregion

// #region Runtime Messages

chrome.runtime
  .onMessage
  .addListener(
    (
      message,
      sender,
      sendResponse
    ) => {
      if (!message) {
        return;
      }


      let operation;


      if (
        message.type
          === STREAMKIT_MESSAGE_TYPE
      ) {
        operation =
          routeSpeakingEvent(
            message,
            sender
          );
      }


      if (
        message.type
          === STREAMKIT_USER_MESSAGE_TYPE
      ) {
        operation =
          routeDiscordUserEvent(
            message,
            sender
          );
      }

      if (
        message.type
          === STREAMKIT_HEALTH_MESSAGE_TYPE
      ) {
        operation =
          routeRelayHealth(
            message,
            sender
          );
      }

      if (!operation) {
        return;
      }


      operation
        .then(
          sendResponse
        )
        .catch(
          (error) => {
            console.error(
              LOG_PREFIX,
              "Unexpected routing failure.",
              error
            );


            sendResponse({
              ok: false,
              error:
                "unexpected-routing-failure"
            });
          }
        );


      return true;
    }
  );

// #endregion


// #region Tab Cleanup

chrome.tabs
  .onRemoved
  .addListener(
    async (tabId) => {
      const paired =
        await getPairedFoundryTab();


      if (
        paired?.tabId
        !== tabId
      ) {
        return;
      }


      await clearPairedFoundryTab();
    }
  );

// #endregion