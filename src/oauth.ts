import GoogleCalendarTaskSync from './main';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { saveSettings } from './settings';
import * as http from 'http';
import { Notice } from 'obsidian';
import {decryptData, encryptData} from './encryptionHandler';
import { debugLog } from './logger';

let server: http.Server | undefined; // Holds the server instance

/**
 * Checks if all required data is present and initializes the plugin.
 */
export async function checkAndInitialize(plugin: GoogleCalendarTaskSync): Promise<void> {
  debugLog(plugin, "Checking if all necessary data is available for initialization...");

  const { encClientId, encClientSecret, encTokenData } = plugin.settings;

  if (!encClientId || !encClientSecret) {
    debugLog(plugin, "Client ID or Client Secret is missing. Initialization aborted.");
    new Notice("Google Calendar setup incomplete. Please provide client ID and secret.");
    return;
  }

  if (!encTokenData || encTokenData.trim() === "") {
    debugLog(plugin, "Token data is missing. User authentication is required.");
    new Notice("Authentication required. Please authenticate with Google Calendar.");
    return;
  }

  try {
    // Initialize the OAuth client
    initializeOAuthClient(plugin, decryptData(plugin, encClientId), decryptData(plugin, encClientSecret));

    if (!plugin.oAuth2Client) {
      throw new Error("OAuth2 client initialization failed.");
    }

    // Load and set tokens
    loadAndSetTokens(plugin);

    // Attempt to refresh the access token to ensure validity
    await refreshAccessToken(plugin);

    debugLog(plugin, "Google Calendar plugin initialized successfully.");
    new Notice("Google Calendar plugin is ready to use.");
  } catch (error) {
    console.error("Error during plugin initialization:", error);
    new Notice("Failed to initialize Google Calendar plugin. Check console for details.");
  }
}

export function initializeOAuthClient(
  plugin: GoogleCalendarTaskSync,
  decClientId?: string,
  decClientSecret?: string,
  decTokenData?: string
): void {
  try {
    // Case 1: Initialize with token data if explicitly provided
    if (decTokenData) {
      try {
        const decryptedTokens = JSON.parse(decTokenData);
        if (!decryptedTokens) {
          throw new Error("Decrypted token data is invalid or empty.");
        }

        debugLog(plugin, "Initializing OAuth2 client with provided token data.");
        plugin.oAuth2Client = new google.auth.OAuth2(); // Initialize OAuth2 client without explicit credentials
        plugin.oAuth2Client.setCredentials(decryptedTokens);
        debugLog(plugin, "OAuth2 client successfully initialized with token data.");
        return; // Exit if token data is successfully used
      } catch (error) {
        throw new Error(`Failed to parse provided token data: ${error.message}`);
      }
    }

    // Case 2: Initialize with decrypted client ID and secret
    if (decClientId && decClientSecret) {
      debugLog(plugin, `Initializing OAuth2 client with decrypted credentials.`);
      plugin.oAuth2Client = new google.auth.OAuth2(decClientId, decClientSecret, `http://localhost`);
      debugLog(plugin, "OAuth2 client successfully initialized with credentials.");
      return; // Exit if credentials are successfully used
    }

    // Case 3: Neither credentials nor token data are available
    throw new Error("No valid credentials or token data available for OAuth2 client initialization.");
  } catch (error) {
    console.error("Failed to initialize OAuth2 client:", error);
    plugin.oAuth2Client = null; // Clear the client in case of failure
    new Notice("Failed to initialize OAuth2 client. Please check your settings or reauthenticate.");
  }
}

/**
 * Main function to authenticate with Google.
 */
export async function authenticateWithGoogle(plugin: GoogleCalendarTaskSync, decClientId: string, decClientSecret: string): Promise<void> {
  initializeOAuthClient(plugin, decClientId, decClientSecret);

  if (!plugin.oAuth2Client) {
    new Notice("OAuth2 client could not be initialized. Please check your credentials.");
    return;
  }

  try {
    const redirectUri = await startOAuthServer(plugin);
    const authUrl = generateAuthUrl(plugin, redirectUri);
    debugLog(plugin, `Generated Auth URL: ${authUrl}`);
    window.open(authUrl, "_blank");
    new Notice("Authentication started. Please check your browser to continue.");
  } catch (error) {
    console.error("Failed to start OAuth authentication process:", error);
    new Notice("Failed to start OAuth authentication process.");
  }
}

/**
 * Starts the OAuth server to listen for Google's callback.
 */
export async function startOAuthServer(plugin: GoogleCalendarTaskSync): Promise<string> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => handleOAuthCallback(req, res, plugin));
    server.listen(0, () => {
      const addressInfo = server?.address();
      if (addressInfo && typeof addressInfo === "object") {
        const port = addressInfo.port;
        const redirectUri = `http://localhost:${port}`;
        plugin.redirectUri = redirectUri;
        debugLog(plugin, `OAuth server listening on ${redirectUri}`);
        resolve(redirectUri);
      } else {
        reject(new Error("Failed to start the OAuth server."));
      }
    });
  });
}

/**
 * Handles the OAuth callback from Google.
 */
function handleOAuthCallback(req: http.IncomingMessage, res: http.ServerResponse, plugin: GoogleCalendarTaskSync): void {
  if (req.url?.startsWith("/?code=")) {
    const code = new URL(req.url, `http://localhost`).searchParams.get("code");
    res.end("Authentication successful! You can close this window.");
    server?.close();

    if (code) {
      exchangeCodeForTokens(plugin, code).catch((error) => {
        console.error("Error during token exchange:", error);
        new Notice("Failed to exchange token with Google.");
      });
    }
  }
}

/**
 * Exchanges the authorization code for tokens.
 */
async function exchangeCodeForTokens(plugin: GoogleCalendarTaskSync, code: string): Promise<void> {
  try {
    const { tokens } = await plugin.oAuth2Client.getToken({
      code,
      redirect_uri: plugin.redirectUri,
    });
    plugin.oAuth2Client.setCredentials(tokens);
    plugin.settings.encTokenData = encryptData(plugin, JSON.stringify(tokens));
    await saveSettings(plugin, plugin.settings);
    new Notice("Google Calendar API authorized successfully and tokens saved.");
  } catch (error) {
    console.error("Error during token exchange:", error);
    throw new Error("Token exchange failed.");
  }
}

/**
 * Generates the Google authentication URL.
 */
function generateAuthUrl(plugin: GoogleCalendarTaskSync, redirectUri: string): string {
  return plugin.oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar"],
    redirect_uri: redirectUri,
  });
}

/**
 * Closes the OAuth server.
 */
export function closeOAuthServer(): void {
  if (server) {
    server.close();
    server = undefined;
    console.log("OAuth server closed.");
  }
}

/**
 * Loads the token data from plugin settings, decrypts it, and initializes the OAuth2 client.
 */
export function loadAndSetTokens(plugin: GoogleCalendarTaskSync): void {
  const { encTokenData } = plugin.settings;

  if (!encTokenData || encTokenData.trim() === "") {
    debugLog(plugin, "No valid token data available.");
    return;
  }

  try {
    // Decrypt and parse the token data
    const decryptedTokens = JSON.parse(decryptData(plugin, encTokenData));

    // Initialize the OAuth2 client if it doesn't already exist
    if (!plugin.oAuth2Client) {
      debugLog(plugin, "OAuth2 client not initialized. Creating a new instance.");
      plugin.oAuth2Client = new google.auth.OAuth2();
    }

    // Set the credentials in the OAuth2 client
    plugin.oAuth2Client.setCredentials(decryptedTokens);
    debugLog(plugin, "Token data successfully loaded and set in OAuth2 client.");
  } catch (error) {
    console.error("Failed to load and set tokens:", error);
    new Notice("Failed to load token data. Please authenticate again.");
    plugin.oAuth2Client = null; // Clear the OAuth client to ensure a fresh start on re-authentication
  }
}

/**
 * Refreshes the access token.
 */
export async function refreshAccessToken(plugin: GoogleCalendarTaskSync): Promise<void> {
  const oAuth2Client = plugin.oAuth2Client;
  if (!oAuth2Client) {
    debugLog(plugin, "OAuth2 client not initialized.");
    return;
  }

  try {
    if (!oAuth2Client.credentials.refresh_token) {
      throw new Error("No refresh token available.");
    }

    const tokens = await oAuth2Client.refreshAccessToken();
    const updatedTokens = tokens.credentials;

    plugin.settings.encTokenData = encryptData(plugin, JSON.stringify(updatedTokens));
    await saveSettings(plugin, plugin.settings);

    debugLog(plugin, "Access token successfully refreshed and saved.");
  } catch (error) {
    console.error("Failed to refresh access token:", error);
    new Notice("Failed to refresh access token.");
  }
}
