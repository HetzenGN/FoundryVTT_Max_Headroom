// relay/build.mjs

// #region Imports

import {
  build
} from "esbuild";

// #endregion


// #region Userscript Metadata

const metadata =
`// ==UserScript==
// @name         FoundryVTT Max Headroom - Discord StreamKit Relay
// @namespace    https://github.com/HetzenGN/FoundryVTT_Max_Headroom
// @version      0.3.0
// @description  Discord StreamKit voice relay for FoundryVTT Max Headroom
// @match        https://streamkit.discord.com/overlay/voice/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==`;

// #endregion


// #region Build

await build({
  entryPoints: [
    "./src/main.js"
  ],

  outfile:
    "./streamkit-relay.user.js",

  bundle:
    true,

  format:
    "iife",

  platform:
    "browser",

  target: [
    "es2022"
  ],

  banner: {
    js:
      metadata
  },

  legalComments:
    "none",

  sourcemap:
    false,

  minify:
    false
});


console.log(
  "Built relay/streamkit-relay.user.js"
);

// #endregion