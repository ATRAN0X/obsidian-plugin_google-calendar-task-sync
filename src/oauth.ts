import GoogleCalendarTaskSync from './main';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { saveSettings } from './settings';
import * as http from 'http';
import { Notice } from 'obsidian';
import { encryptData, decryptData } from './encryptionHandler';
import { debugLog } from './logger';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as open from 'open';


let server: http.Server | undefined; // Holds the server instance

/**
 * Initialize the OAuth2 client using decrypted credentials
 */
export function initializeOAuthClient(plugin: GoogleCalendarTaskSync, tempClientId?: string, tempClientSecret?: string): void {
	try {
		// Case 1: Temporary Client ID and Secret are provided (during authentication)
		if (tempClientId && tempClientSecret) {
		  debugLog(plugin, `Initializing OAuth2 client with temp credentials.`);
		  plugin.oAuth2Client = new google.auth.OAuth2(tempClientId, tempClientSecret, `http://localhost`);
		  return; // Stop further processing
		}

		// Case 2: Use token data from settings
		if (plugin.settings.tokenData && plugin.settings.tokenData.trim() !== "") {
		  try {
			const decryptedTokens = JSON.parse(decryptData(plugin, plugin.settings.tokenData));
			debugLog(plugin, `Decrypted tokens successfully.`);

			const oAuth2Client = new google.auth.OAuth2(); // Initialize client without explicit credentials
			oAuth2Client.setCredentials(decryptedTokens);

			plugin.oAuth2Client = oAuth2Client; // Store in plugin for later use
			debugLog(plugin, `OAuth2 client successfully initialized with token data.`);
		  } catch (error) {
			console.error("Failed to decrypt or parse token data:", error);
			new Notice("Invalid or corrupted token data. Please reauthenticate.");
			plugin.oAuth2Client = null;
		  }
		  return; // Stop further processing
		}

		// Case 3: No credentials or token data available
		console.error("No valid credentials or tokens provided.");
		new Notice("No valid credentials or token data found. Please provide credentials or authenticate.");
		plugin.oAuth2Client = null;
	  } catch (error) {
		console.error("Unexpected error while initializing OAuth2 client:", error);
		new Notice("Unexpected error during OAuth2 initialization.");
		plugin.oAuth2Client = null;
	  }
}


// Main function to authenticate with Google
export async function authenticateWithGoogle(plugin: GoogleCalendarTaskSync, tempClientId?: string, tempClientSecret?: string): Promise<void> {
  if (!plugin.oAuth2Client) {
    new Notice("OAuth2 client could not be initialized. Please check your credentials or token data.");
    return;
  }

  try {
    const redirectUri = await startOAuthServer(plugin);
    const authUrl = generateAuthUrl(plugin);
    debugLog(plugin, `Generated Auth URL: ${authUrl}`);
    window.open(authUrl, '_blank');
    new Notice('Authentication started. Please check your browser to continue.');
  } catch (error) {
    console.error('Failed to start OAuth authentication process:', error);
    new Notice('Failed to start OAuth authentication process.');
  }
}


// Start the OAuth server
export async function startOAuthServer(plugin: GoogleCalendarTaskSync): Promise<string> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => handleOAuthCallback(req, res, plugin));
    server.listen(0, () => {
      const addressInfo = server?.address();
      if (addressInfo && typeof addressInfo === 'object') {
        const port = addressInfo.port;
        const redirectUri = `http://localhost:${port}`;
        plugin.redirectUri = redirectUri;
        debugLog(plugin, `OAuth server listening on ${redirectUri}`);
        resolve(redirectUri);
      } else {
        reject(new Error('Failed to start the OAuth server.'));
      }
    });
  });
}

// Handle the OAuth callback
function handleOAuthCallback(req: http.IncomingMessage, res: http.ServerResponse, plugin: GoogleCalendarTaskSync) {
  if (req.url?.startsWith('/?code=')) {
    const code = new URL(req.url, `http://localhost`).searchParams.get('code');
    res.end('Authentication successful! You can close this window.');
    server?.close();

    if (code) {
      exchangeCodeForTokens(plugin, code).catch((error) => {
        console.error('Error during token exchange:', error);
      });
    }
  }
}

// Exchange the code for tokens
async function exchangeCodeForTokens(plugin: GoogleCalendarTaskSync, code: string): Promise<void> {
  try {
    const { tokens } = await plugin.oAuth2Client.getToken({
      code,
      redirect_uri: plugin.redirectUri,
    });
    plugin.oAuth2Client.setCredentials(tokens);
    plugin.settings.tokenData = encryptData(plugin, JSON.stringify(tokens));
    await saveSettings(plugin, plugin.settings);
    new Notice('Google Calendar API authorized successfully and token saved.');
  } catch (error) {
    console.error('Error during token exchange:', error);
    new Notice('Failed to authenticate with Google.');
  }
}

// Generate the Google Auth URL
function generateAuthUrl(plugin: GoogleCalendarTaskSync): string {
  return plugin.oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    redirect_uri: plugin.redirectUri,
  });
}


export function closeOAuthServer(plugin: GoogleCalendarTaskSync): void {
  if (server) {
    server.close();
    server = undefined;
    debugLog(plugin, 'OAuth server closed.');
  }
}


export function loadAndSetTokens(plugin: GoogleCalendarTaskSync): void {
  const { tokenData } = plugin.settings;
  if (!tokenData || tokenData.trim() === "") {
    debugLog(plugin, 'No valid token data available.');
    return;
  }

  try {
    const decryptedTokens = JSON.parse(decryptData(plugin, tokenData));
    plugin.oAuth2Client = new google.auth.OAuth2(); // Initialize OAuth client
    plugin.oAuth2Client.setCredentials(decryptedTokens);
    debugLog(plugin, 'Token data successfully loaded and set in OAuth2 client.');
  } catch (error) {
    console.error('Failed to load and set tokens:', error);
    new Notice('Failed to load token data. Please authenticate again.');
    plugin.oAuth2Client = null;
  }
}


export async function refreshAccessToken(plugin: GoogleCalendarTaskSync): Promise<void> {
  const oAuth2Client = plugin.oAuth2Client;
  if (!oAuth2Client) {
    debugLog(plugin, 'OAuth2 client not initialized. Cannot refresh token.');
    return;
  }

  try {
    const { credentials } = oAuth2Client;
    const expirationBuffer = 60 * 5 * 1000; // 5 Minuten Pufferzeit
    const now = new Date().getTime();

    if (credentials.expiry_date && credentials.expiry_date - now > expirationBuffer) {
      debugLog(plugin, 'Access token is still valid. No refresh required.');
      return;
    }

    debugLog(plugin, 'Refreshing access token...');
    const tokens = await oAuth2Client.refreshAccessToken();
    const updatedTokens = tokens.credentials;
    plugin.settings.tokenData = encryptData(plugin, JSON.stringify(updatedTokens));
    await saveSettings(plugin, plugin.settings);

    debugLog(plugin, 'Access token successfully refreshed and saved.');
    new Notice('Access token refreshed successfully.');
  } catch (error) {
    console.error('Failed to refresh access token:', error);
    new Notice('Failed to refresh access token. Please authenticate again.');
  }
}
