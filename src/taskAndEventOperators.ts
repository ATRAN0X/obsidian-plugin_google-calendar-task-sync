import { calendar_v3, google } from "googleapis";
import GoogleCalendarTaskSync from "./main";
import { mapYamlToEvent, saveTaskDataToYaml, logInfo } from "./fileHelpers";
import { Notice, TFile } from "obsidian";
import { getGoogleCalendarEvents } from "./dataFetchers";
import {debugLog} from "./logger";
import {decryptData} from "./encryptionHandler";
import {refreshAccessToken} from "./oauth";


export async function deleteEvent(plugin: GoogleCalendarTaskSync, eventId) {
  const calendar = google.calendar({ version: 'v3', auth: plugin.oAuth2Client });
  try {
	await calendar.events.delete({
	  calendarId: 'primary',
	  eventId: eventId,
	});
	debugLog(plugin, `Successfully deleted event with ID: ${eventId}`);
  } catch (error) {
	throw new Error(`Failed to delete event with ID: ${eventId}: ${error.message}`);
  }
}

export async function createEventForTask(plugin: GoogleCalendarTaskSync, task: any) {
	const calendar = google.calendar({ version: 'v3', auth: plugin.oAuth2Client });
	try {
		const event = await mapYamlToEvent(plugin, task.data, task.file);

		const createdEvent = await calendar.events.insert({
			calendarId: 'primary',
			resource: event,
		});

		// Speichere die Event-ID zurück in die YAML-Frontmatter des Tasks
		task.data.googleEventId = createdEvent.data.id;
		await saveTaskDataToYaml(plugin, task.file, task.data);
	} catch (error) {
		throw new Error(`Error creating event for task ${task.file.basename}: ${error.message}`);
	}
}

export async function deleteAllGoogleEventsFromTasks(plugin: GoogleCalendarTaskSync): Promise<void> {
  debugLog(plugin, "Starting deletion of all Google Calendar events...");

  // Refresh the access token to ensure it's valid
  await refreshAccessToken(plugin);

  // Fetch all Google Calendar events
  const eventsToDelete = await getGoogleCalendarEvents(plugin);
  const totalEvents = eventsToDelete.length;

  if (totalEvents === 0) {
    new Notice("No events found in Google Calendar to delete.");
    return;
  }

  // Progress notification
  const progressNotice = new Notice(`Deleting 0 of ${totalEvents} events...`, 0);

  for (let i = 0; i < totalEvents; i++) {
    try {
      // Delete the event and update corresponding files
      await deleteEventAndRemoveField(plugin, eventsToDelete[i]);
      progressNotice.setMessage(`Deleting ${i + 1} of ${totalEvents} events...`);
    } catch (error) {
      console.error(`Failed to delete event ${eventsToDelete[i].id}:`, error);
    }
  }

  progressNotice.setMessage(`Successfully deleted ${totalEvents} events.`);
  setTimeout(() => progressNotice.hide(), 3000);

  debugLog(plugin, `Successfully deleted ${totalEvents} Google Calendar events.`);
}


export async function deleteEventAndRemoveField(plugin: GoogleCalendarTaskSync, event: calendar_v3.Schema$Event): Promise<void> {
  if (!event.id) {
    debugLog(plugin, "Event ID is missing. Skipping deletion.");
    return;
  }

  const calendar = google.calendar({ version: "v3", auth: plugin.oAuth2Client });

  try {
    // Step 1: Delete the event from Google Calendar
    await calendar.events.delete({
      calendarId: "primary",
      eventId: event.id,
    });

    debugLog(plugin, `Deleted Google Calendar event: ${event.id}`);

    // Step 2: Remove the `googleEventId` field from corresponding Obsidian files
    await processVaultFilesForDeletion(plugin, event.id);

  } catch (error) {
    // Log the error and ensure no YAML modifications occur
    console.error(`Failed to delete event with ID ${event.id}:`, error);
    new Notice(`Failed to delete event with ID ${event.id}. Check console for details.`);
  }
}



export async function processVaultFilesForDeletion(plugin: GoogleCalendarTaskSync, googleEventId?: string): Promise<void> {
  const files = plugin.app.vault.getMarkdownFiles();

  for (const file of files) {
    await removeGoogleEventIdField(plugin, file, googleEventId);
  }
}


export async function removeGoogleEventIdField(plugin: GoogleCalendarTaskSync, file: TFile, googleEventId?: string): Promise<void> {
  const content = await plugin.app.vault.read(file);
  const lines = content.split("\n");
  const yamlStartIndex = lines.indexOf("---");
  const yamlEndIndex = lines.indexOf("---", yamlStartIndex + 1);

  if (yamlStartIndex !== -1 && yamlEndIndex !== -1) {
    const yamlContent = lines.slice(yamlStartIndex + 1, yamlEndIndex);
    const updatedYamlContent = yamlContent.filter(line => {
      if (googleEventId && line.includes(`googleEventId: ${googleEventId}`)) {
        return false; // Remove specific googleEventId
      }
      return !line.trim().startsWith("googleEventId:");
    });

    if (yamlContent.length !== updatedYamlContent.length) {
      const updatedContent = [
        ...lines.slice(0, yamlStartIndex + 1),
        ...updatedYamlContent,
        ...lines.slice(yamlEndIndex),
      ].join("\n");

      await plugin.app.vault.modify(file, updatedContent);
      debugLog(plugin, `Updated file: ${file.path} - Removed googleEventId`);
    }
  }
}
