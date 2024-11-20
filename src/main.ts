import {Notice, Plugin} from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS, loadSettings } from './settings';
import {initializeOAuthClient, loadAndSetTokens, refreshAccessToken} from './oauth';
import { addCommands } from './obsidianCommands';
import * as path from 'path';
import * as http from 'http';
import { OAuth2Client } from 'google-auth-library';
import { GoogleCalendarSettingTab } from './obsidianSettingsTab';
import {google} from "googleapis";
import {debugLog} from "./logger";

export default class GoogleCalendarTaskSync extends Plugin {
  settings: PluginSettings;
  oAuth2Client: OAuth2Client | null = null;
  tokenFilePath: string;
  redirectUri: string;
  server?: http.Server;

  async onload() {

    console.log("Plugin loading...");
	console.log("Checking app and vault:", this.app, this.app?.vault);

	if (!this.app || !this.app.vault) {
		console.error("App or vault not initialized properly.");
		return;
		}

	  // load plugin-settings
    this.settings = await loadSettings(this, DEFAULT_SETTINGS);

    // set path to tokens
    const vaultPath = (this.app.vault.adapter as any).basePath;
    this.tokenFilePath = path.join(vaultPath, '.obsidian', 'plugins', this.manifest.id, 'data.json');

	// Token laden und setzen
	loadAndSetTokens(this);

	// Token aktualisieren, falls notwendig
	await refreshAccessToken(this);

	// Check for valid OAuth client
	if (!this.oAuth2Client) {
		new Notice('No existing tokens found. Please authenticate with Google Calendar.');
	} else {
		debugLog(this, `OAuth2 client initialized and ready.`);
		new Notice('Google Calendar authenticated successfully.');
	}

    // Other initialization code
    this.addSettingTab(new GoogleCalendarSettingTab(this.app, this));

    // Register commands (Quick Sync, Full Sync etc.)
    const { addCommands } = await import('./obsidianCommands');
	addCommands(this);
  }
}
