import { calendar_v3, google } from "googleapis";
import GoogleCalendarTaskSync from "./main";
import { mapYamlToEvent, saveTaskDataToYaml, logInfo } from "./fileHelpers";
import { Notice, TFile } from "obsidian";
import { getGoogleCalendarEvents } from "./dataFetchers";
import {debugLog} from "./logger";


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
	// Always process files to remove googleEventId regardless of Google Calendar events
	logInfo('Processing vault files to remove Google Calendar event IDs...');
	await processVaultFiles(plugin);

	const eventsToDelete = await getGoogleCalendarEvents(plugin);
	const totalEvents = eventsToDelete.length;
	const progressNotice = new Notice(`Deleting 0 of ${totalEvents} events...`, 0);

	for (let i = 0; i < totalEvents; i++) {
	  await deleteEventAndRemoveField(plugin, eventsToDelete[i]);
	  progressNotice.setMessage(`Deleting ${i + 1} of ${totalEvents} events...`);
	}

	progressNotice.setMessage(`Successfully deleted ${totalEvents} events.`);
	setTimeout(() => progressNotice.hide(), 3000);
	}



export async function deleteEventAndRemoveField(plugin: GoogleCalendarTaskSync, event: calendar_v3.Schema$Event): Promise<void> {
	const auth = new google.auth.OAuth2(plugin.settings.clientId, plugin.settings.clientSecret);
	auth.setCredentials(plugin.settings.tokenData);

	const calendar = google.calendar({ version: 'v3', auth });

	// Delete the event from Google Calendar
	await calendar.events.delete({
	  calendarId: 'primary',
	  eventId: event.id!,
	});

	// Log information about the deleted event
	logInfo(`Deleted Google Calendar event: ${event.id}`);

	// Process vault files and remove googleEventId field if found
	await processVaultFiles(plugin, event.id!);
}

export async function processVaultFiles(plugin: GoogleCalendarTaskSync, googleEventId?: string): Promise<void> {
	const files = plugin.app.vault.getMarkdownFiles();

	for (const file of files) {
	  if (googleEventId) {
		await removeGoogleEventIdField(plugin, file, googleEventId);
	  } else {
		await removeGoogleEventIdField(plugin, file);
	  }
	}
}

export async function removeGoogleEventIdField(plugin: GoogleCalendarTaskSync, file: TFile, googleEventId?: string): Promise<void> {
	const content = await plugin.app.vault.read(file);
	const lines = content.split('\n');
	const yamlStartIndex = lines.indexOf('---');
	const yamlEndIndex = lines.indexOf('---', yamlStartIndex + 1);

	if (yamlStartIndex !== -1 && yamlEndIndex !== -1) {
	  const yamlContent = lines.slice(yamlStartIndex + 1, yamlEndIndex);
	  const updatedYamlContent = yamlContent.filter(line => {
		if (googleEventId && line.includes(`googleEventId: ${googleEventId}`)) {
		  return false;
		}
		return !line.trim().startsWith('googleEventId:');
	  });

	  if (yamlContent.length !== updatedYamlContent.length) {
		const updatedContent = [
		  ...lines.slice(0, yamlStartIndex + 1),
		  ...updatedYamlContent,
		  ...lines.slice(yamlEndIndex),
		].join('\n');

		await plugin.app.vault.modify(file, updatedContent);
		logInfo(`Updated file: ${file.path} - Removed googleEventId`);
	  }
	}
}
