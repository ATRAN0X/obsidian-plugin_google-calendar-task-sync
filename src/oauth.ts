import ExtendedGoogleCalendarSync from './main';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { saveSettings } from './settings';
import * as http from 'http';
import { Notice } from 'obsidian';
import { encryptData, decryptData } from './encryptionHandler';
import { debugLog } from './logger';

let server: http.Server | undefined; // Holds the server instance

/**
 * Initialize the OAuth2 client using decrypted credentials
 */
export function initializeOAuthClient(plugin: ExtendedGoogleCalendarSync): OAuth2Client | null {
  const { clientId, clientSecret } = plugin.settings;

  if (!clientId || !clientSecret) {
    debugLog(plugin, 'Cannot initialize OAuth2 client: Missing Client ID or Client Secret.');
    return null;
  }

  try {
    const decryptedClientId = decryptData(plugin, clientId);
    const decryptedClientSecret = decryptData(plugin, clientSecret);

    // Note: Redirect URI is dynamically generated
    plugin.oAuth2Client = new google.auth.OAuth2(decryptedClientId, decryptedClientSecret, `http://localhost`);
    debugLog(plugin, 'OAuth2 client initialized successfully.');
    return plugin.oAuth2Client;
  } catch (error) {
    console.error('Failed to initialize OAuth2 client:', error);
    return null;
  }
}

/**
 * Start the Google authentication process
 */
export async function authenticateWithGoogle(plugin: ExtendedGoogleCalendarSync): Promise<void> {
  const oAuth2Client = plugin.oAuth2Client ?? initializeOAuthClient(plugin);
  if (!oAuth2Client) return;

  closeOAuthServer(plugin); // Close any previous server

  // Create a new server
  server = http.createServer(async (req, res) => {
    if (req.url?.startsWith('/?code=')) {
      const code = new URL(req.url, `http://localhost`).searchParams.get('code');
      res.end('Authentication successful! You can close this window.');
      server?.close();

      if (code) {
        try {
          const { tokens } = await oAuth2Client.getToken({
            code,
            redirect_uri: plugin.redirectUri, // Dynamic redirect URI with the correct port
          });
          oAuth2Client.setCredentials(tokens); // Set tokens in OAuth client
          plugin.settings.tokenData = encryptData(plugin, JSON.stringify(tokens)); // Encrypt and save tokens
          await saveSettings(plugin, plugin.settings);
          new Notice('Google Calendar API authorized successfully and token saved.');
        } catch (error) {
          console.error('Error during token exchange:', error);
          new Notice('Failed to authenticate with Google.');
        }
      }
    }
  });

  // Dynamically assign a port and start the server
  server.listen(0, () => {
    const addressInfo = server?.address();
    if (addressInfo && typeof addressInfo === 'object') {
      const port = addressInfo.port;
      const redirectUri = `http://localhost:${port}`; // Construct dynamic redirect URI
      plugin.redirectUri = redirectUri; // Save redirect URI to plugin settings

      debugLog(plugin, `OAuth server listening on ${redirectUri}`);

      // Generate the Google Auth URL with the dynamic redirect URI
      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar'],
        redirect_uri: redirectUri, // Use the dynamic redirect URI
      });

      debugLog(plugin, `Generated Auth URL: ${authUrl}`);
      window.open(authUrl, '_blank'); // Open the authentication URL in the browser
      new Notice('Authentication started. Please check your browser to continue.');
    } else {
      new Notice('Failed to start the OAuth server.');
    }
  });
}

/**
 * Close the OAuth server if it is running
 */
export function closeOAuthServer(plugin: ExtendedGoogleCalendarSync): void {
  if (server) {
    server.close();
    server = undefined;
    debugLog(plugin, 'OAuth server closed.');
  }
}
