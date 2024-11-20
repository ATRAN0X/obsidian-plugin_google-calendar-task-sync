import {Notice, Plugin} from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS, loadSettings } from './settings';
import { initializeOAuthClient } from './oauth';
import { addCommands } from './obsidianCommands';
import * as path from 'path';
import * as http from 'http';
import { OAuth2Client } from 'google-auth-library';
import { GoogleCalendarSettingTab } from './obsidianSettingsTab';

export default class ExtendedGoogleCalendarSync extends Plugin {
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

	  // Plugin-Einstellungen laden
    this.settings = await loadSettings(this, DEFAULT_SETTINGS);

    // Only initialize OAuth client after settings are loaded and contain clientId and clientSecret
    if (this.settings.clientId && this.settings.clientSecret) {
      this.oAuth2Client = initializeOAuthClient(this);
    } else {
      new Notice('Please set your Google API client ID and client secret in the settings.');
    }

    // Pfad für Token-Datei setzen
    const vaultPath = (this.app.vault.adapter as any).basePath;
    this.tokenFilePath = path.join(vaultPath, '.obsidian', 'plugins', this.manifest.id, 'data.json');

    // Other initialization code
    this.addSettingTab(new GoogleCalendarSettingTab(this.app, this));

    // Register commands (Quick Sync, Full Sync etc.)
    addCommands(this);
  }
}
