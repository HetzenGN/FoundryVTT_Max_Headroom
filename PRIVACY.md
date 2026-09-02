# FoundryVTT Max Headroom Relay Privacy Policy

Last updated: August 31, 2026

## Overview

FoundryVTT Max Headroom Relay is a browser companion extension for the FoundryVTT Max Headroom module. Its sole purpose is to relay limited Discord StreamKit voice-state information from Discord StreamKit to a Foundry Virtual Tabletop game explicitly selected by the user.

The extension does not operate a developer-controlled data collection service and does not send user information to the developer.

## Information Handled

While a Discord StreamKit Voice overlay is open, the extension may process the following information provided by Discord StreamKit:

* Discord user IDs
* Discord usernames and server nicknames
* Discord guild and voice-channel IDs
* Whether a Discord user is present in the voice channel
* Whether a Discord user is currently speaking
* Whether a Discord user is muted
* Relay connection and heartbeat information

The extension does not capture, record, process, or transmit voice audio or the contents of Discord messages.

When pairing with Foundry VTT, the extension may also temporarily process information needed to identify the user-selected Foundry tab, such as the Foundry world name, Foundry user name, module version, and tab identifier.

## How Information Is Used

The information described above is used only to provide the extension's core functionality:

* Identify Discord voice users for friendly mapping inside Foundry VTT.
* Update reactive Foundry portraits when Discord users speak or mute themselves.
* Report whether the Discord StreamKit relay is connected.
* Maintain the user's selected Foundry tab during the current browser session.

The extension does not use this information for advertising, analytics, profiling, marketing, or any unrelated purpose.

## Storage

The extension uses Chrome session storage to remember the paired Foundry tab and temporary StreamKit relay status during the browser session.

This information is not stored in a developer-controlled database or transmitted to a developer-controlled server.

Persistent Discord-to-Foundry portrait mappings are managed by the separately installed FoundryVTT Max Headroom module within the user's own Foundry VTT installation.

## Data Sharing and Transfers

The extension transfers the voice-state information required for its functionality only between Discord StreamKit and the Foundry VTT game explicitly paired by the user.

The developer does not receive this information.

The extension does not sell user information.

The extension does not transfer user information for advertising, marketing, creditworthiness, or other unrelated purposes.

## Remote Code

The extension does not download or execute remotely hosted program code. Extension logic is contained within the installed extension package.

## Permissions

The extension requests only the browser permissions required for its functionality:

**activeTab** permits the user to explicitly select the current Foundry VTT tab for pairing.

**scripting** allows the extension to verify that the selected tab is a compatible Foundry VTT game and communicate with the installed FoundryVTT Max Headroom module.

**storage** is used for temporary browser-session pairing and relay-status information.

The extension's Discord StreamKit content scripts are restricted to Discord's StreamKit Voice overlay pages.

## Limited Use

Use of information received through browser permissions is limited to providing and improving the user-facing functionality described in this policy and in the Chrome Web Store listing.

User information is not used for personalized advertising, transferred for advertising purposes, or made available for humans to read except when a user voluntarily provides information as part of a support request or when otherwise required by law or necessary for security.

## User Control

Users can clear the current Foundry pairing through the extension popup.

Users can stop all processing by closing Discord StreamKit, disabling the extension, or uninstalling the extension.

## Changes

Material changes to this policy will be published with the project documentation before or alongside the extension version implementing those changes.

## Contact and Source

Project documentation and source code are available at:

https://github.com/HetzenGN/FoundryVTT_Max_Headroom
