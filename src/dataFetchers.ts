import * as fs from 'fs';
import * as path from 'path';
import GoogleCalendarTaskSync from "./main";
import { calendar_v3, google } from "googleapis";
import {Notice} from "obsidian";
import {findMatchingFolderPairs} from "./fileHelpers";
import {debugLog} from "./logger";


export async function fetchObsidianTasks(plugin: GoogleCalendarTaskSync, tag: string): Promise<any[]> {
    const tasks: any[] = [];
    const taskRootFolder = plugin.settings.taskFolderPath;
    const searchFolderName = plugin.settings.searchFolderName;
    const doneFolderName = plugin.settings.doneFolderName;

    // Find all pairs of `searchFolderName` and `doneFolderName` folders within the `taskRootFolder`
    const folderPairs = findMatchingFolderPairs(plugin, plugin.app.vault, taskRootFolder, searchFolderName, doneFolderName);

    // Retrieve all markdown files in the vault
    const markdownFiles = plugin.app.vault.getMarkdownFiles();

    // Filter files based on their paths being inside one of the `searchFolder` paths
    const taskFiles = markdownFiles.filter(file =>
        Object.values(folderPairs).some(({ searchPath }) => file.path.startsWith(searchPath))
    );

    // Process each filtered file to check for the tag in the frontmatter
    for (const file of taskFiles) {
        const cache = plugin.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter && cache.frontmatter.tags?.includes(tag)) {
            tasks.push({
                name: file.basename,
                data: cache.frontmatter,
                file: file,
            });
        }
    }

    debugLog(plugin, `Total tasks with tag "${tag}" in folders matching "${searchFolderName}":`);

    return tasks;
}

// Retrieves events from the Google Calendar API
export async function getGoogleCalendarEvents(plugin: GoogleCalendarTaskSync): Promise<calendar_v3.Schema$Event[]> {
  // Ensure the OAuth2 client is initialized and has valid credentials
  if (!plugin.oAuth2Client) {
    throw new Error("OAuth2 client is not initialized. Please authenticate with Google.");
  }

  try {
    // Refresh access token if necessary
    const tokens = await plugin.oAuth2Client.getAccessToken();
    if (tokens.token) {
      plugin.oAuth2Client.setCredentials({ access_token: tokens.token });
    }

    // Access the Google Calendar API
    const calendar = google.calendar({ version: "v3", auth: plugin.oAuth2Client });

    // Retrieve the calendar events
    const response = await calendar.events.list({
      calendarId: "primary",
      maxResults: 2500,
    });

    return response.data.items || [];
  } catch (error) {
    console.error("Failed to retrieve Google Calendar events:", error);
    throw new Error("Error fetching Google Calendar events. Please check the console for details.");
  }
}
