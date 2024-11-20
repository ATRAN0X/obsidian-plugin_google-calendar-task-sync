import {Notice, Plugin} from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS, loadSettings } from './settings';
import { initializeOAuthClient } from './oauth';
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

	  // Plugin-Einstellungen laden
    this.settings = await loadSettings(this, DEFAULT_SETTINGS);

    // Pfad für Token-Datei setzen
    const vaultPath = (this.app.vault.adapter as any).basePath;
    this.tokenFilePath = path.join(vaultPath, '.obsidian', 'plugins', this.manifest.id, 'data.json');

	// Initialize the OAuth2 client using the stored token data
	if (this.settings.tokenData) {
		const { decryptData } = await import('./encryptionHandler');
		try {
		  // Decrypt and parse the token data
		  let decryptedTokens = JSON.parse(decryptData(this, this.settings.tokenData));

		  this.oAuth2Client = new google.auth.OAuth2(); // Initialize OAuth client
		  this.oAuth2Client.setCredentials(decryptedTokens); // Set the credentials from the decrypted tokens
		  debugLog(this, `OAuth2 client initialized with existing tokens.`);
		  new Notice('Google Calendar authenticated successfully.');

		  decryptedTokens = null;

		} catch (error) {
		  console.error('Failed to initialize OAuth2 client with existing tokens:', error);
		  new Notice('Failed to load existing authentication tokens. Please reauthenticate.');
		}
	} else {
		// No token data available; ask the user to authenticate
		new Notice('No existing tokens found. Please authenticate with Google Calendar.');
	}

    // Other initialization code
    this.addSettingTab(new GoogleCalendarSettingTab(this.app, this));

    // Register commands (Quick Sync, Full Sync etc.)
    const { addCommands } = await import('./obsidianCommands');
	addCommands(this);
  }
}
