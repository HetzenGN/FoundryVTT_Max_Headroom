// relay/extension/service-worker.js

// #region Constants

const MODULE_ID =
  "foundryvtt-max-headroom";

const STREAMKIT_MESSAGE_TYPE =
  "MAX_HEADROOM_STREAMKIT_SPEAKING";

const STORAGE_KEY =
  "pairedFoundryTab";

const STREAMKIT_ORIGIN =
  "https://streamkit.discord.com";

const STREAMKIT_PATH_PREFIX =
  "/overlay/voice/";

const LOG_PREFIX =
  "[Max Headroom extension]";

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
            speakingPayload
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
                ?.receiveExtensionSpeakingEvent;


            if (
              typeof receive
              !== "function"
            ) {
              return {
                ok: false,
                error:
                  "foundry-ingress-unavailable"
              };
            }


            try {
              return (
                receive(
                  speakingPayload
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


// #region Runtime Messages

chrome.runtime
  .onMessage
  .addListener(
    (
      message,
      sender,
      sendResponse
    ) => {
      if (
        !message
        || message.type
          !== STREAMKIT_MESSAGE_TYPE
      ) {
        return;
      }


      routeSpeakingEvent(
        message,
        sender
      )
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