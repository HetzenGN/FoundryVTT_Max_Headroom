// scripts/main.js

// #region Imports

import {
  MODULE_ID,
  PROTOCOL_VERSION
} from "../shared/protocol.js";

import {
  registerSettings,
  isPortraitRenderSettingKey
} from "./settings.js";

import {
  registerPortraitPreferencesMenu
} from "./portraits/portrait-preferences-app.js";

import {
  portraitBar
} from "./portraits/portrait-bar.js";

import {
  portraitDebugApi
} from "./portraits/portrait-debug.js";

import {
  registerPortraitConfigMenu
} from "./portraits/portrait-config-app.js";

import {
  relayController
} from "./relay/relay-controller.js";

import {
  registerRelayControllerMenu
} from "./relay/relay-controller-app.js";

import {
  relayDebugApi
} from "./relay/relay-debug.js";

import {
  socketService
} from "./relay/socket-service.js";

// #endregion


// #region Constants

const LOG_PREFIX = "[FoundryVTT_Max_Headroom]";

// #endregion


// #region Public Module API

/**
 * Public module API.
 *
 * Additional relay and synchronization methods will be added here
 * as those components are implemented.
 *
 * Access through:
 *
 * game.modules.get(MODULE_ID).api
 */
const moduleApi = {
  MODULE_ID,
  PROTOCOL_VERSION,


  /**
   * Chromium companion-extension ingress.
   *
   * This intentionally exposes only the small
   * extension transport envelope, not RelayState
   * mutation APIs.
   */
  receiveExtensionRelayHealth(
    payload
  ) {
    return relayController
      .receiveExtensionRelayHealth(
        payload
      );
  },

  receiveExtensionSpeakingEvent(
    payload
  ) {
    return relayController
      .receiveExtensionSpeakingEvent(
        payload
      );
  },

  receiveExtensionDiscordUserEvent(
  payload
) {
  return relayController
    .receiveExtensionDiscordUserEvent(
      payload
    );
},


getDiscoveredDiscordUsers() {
  return relayController
    .getDiscoveredDiscordUsers();
},

  ...portraitDebugApi,
  ...relayDebugApi
};

// #endregion


// #region Foundry Hooks

/**
 * Foundry initialization.
 *
 * Use this phase for:
 * - settings registration
 * - public API setup
 * - hooks which must exist before the world is ready
 */
Hooks.once("init", () => {
  console.log(
    `${LOG_PREFIX} Initializing`
  );

  // #region Register Settings

  registerSettings();

  registerPortraitConfigMenu();
  registerPortraitPreferencesMenu();
  registerRelayControllerMenu();

  // #endregion

  // #region Register Public API

  const module =
    game.modules.get(MODULE_ID);

  if (!module) {
    console.error(
      `${LOG_PREFIX} Unable to locate module package "${MODULE_ID}".`
    );

    return;
  }

  module.api = moduleApi;

  // #endregion

  console.log(
    `${LOG_PREFIX} Protocol v${PROTOCOL_VERSION} initialized`
  );
});


/**
 * Foundry ready.
 *
 * Services which require prepared world data, users, settings,
 * sockets, or UI should start here.
 */
Hooks.once("ready", async () => {
  console.log(
    `${LOG_PREFIX} Ready`
  );

  // #region Initialize Relay Controller

try {
  relayController.initialize();

  console.log(
    `${LOG_PREFIX} Relay Controller initialized`
  );
} catch (error) {
  console.error(
    `${LOG_PREFIX} Failed to initialize Relay Controller.`,
    error
  );
}

// #endregion

  // #region Initialize Portrait Bar

  try {
    await portraitBar.render({
      force: true
    });

    console.log(
      `${LOG_PREFIX} Reactive Portrait Bar initialized`
    );
  } catch (error) {
    console.error(
      `${LOG_PREFIX} Failed to initialize Reactive Portrait Bar.`,
      error
    );
  }

  // #endregion

  // #region Portrait Presentation Setting Updates

Hooks.on(
  "updateSetting",
  (setting) => {
    if (
      !isPortraitRenderSettingKey(
        setting.key
      )
    ) {
      return;
    }

    portraitBar
      .refresh()
      .catch(
        (error) => {
          console.error(
            `${LOG_PREFIX} Failed to refresh Portrait Bar after a presentation setting changed.`,
            error
          );
        }
      );
  }
);

// #endregion
  
// #region Request Initial State Sync

try {
  /*
   * A newly-connected or reloaded non-authoritative client starts with
   * an empty PortraitStateStore. Ask the active relay-host GM for the
   * current authoritative state.
   *
   * The active relay host already owns the authoritative state locally
   * and does not need to request it from itself.
   */
  if (!socketService.isAuthoritative()) {
    socketService.requestFullSync();
  }
} catch (error) {
  console.error(
    `${LOG_PREFIX} Failed to request initial portrait state synchronization.`,
    error
  );
}

// #endregion

});

// #endregion