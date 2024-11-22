import GoogleCalendarTaskSync from "./main";
import { Notice, TFile } from "obsidian";
import {
	findMatchingFolderPairs,
	getLogFilePath,
	moveTaskToFolder,
	saveTaskDataToYaml,
} from "./fileHelpers";
import { fetchObsidianTasks } from "./dataFetchers";
import { calendar_v3, google } from "googleapis";
import { GaxiosResponse } from 'googleapis-common';
import {deleteEvent, createEventForTask} from "./taskAndEventOperators";
import { saveSettings } from "./settings";
import { mapYamlToEvent } from "./fileHelpers"
import {debugLog, writeErrorLogs} from "./logger";
import {loadAndSetTokens, refreshAccessToken} from "./oauth";


export async function syncGoogleCalendarWithObsidian(
	plugin: GoogleCalendarTaskSync,
	tag: string = 'task',
	isQuickSync: boolean = false
) {
	debugLog(plugin, "Sync function called with plugin.");

	// Check if OAuth2 client is initialized
	if (!plugin.oAuth2Client) {
		debugLog(plugin, "OAuth2 client not initialized. Loading tokens...");
		loadAndSetTokens(plugin);
	}

	if (!plugin.oAuth2Client) {
		new Notice("Please authenticate with Google Calendar first.");
		return;
	}

	if (!plugin.settings.encTokenData) {
		new Notice("Please authenticate with Google Calendar first.");
		return;
	}

	// Check if the 'status' field is set in the plugin settings
    if (!plugin.settings.fieldMappings.status || plugin.settings.fieldMappings.status.trim() === "") {
        throw new Error("The 'status' field in the settings is not defined. Please set it in the plugin settings.");
    }

	// Refresh access token if necessary
	await refreshAccessToken(plugin);

	// Retrieve user-defined root, search, and done folders
	const taskRootFolder = plugin.settings.taskFolderPath;
	const searchFolderName = plugin.settings.searchFolderName;
	const doneFolderName = plugin.settings.doneFolderName;

	// Find all folder pairs with `searchFolderName` and `doneFolderName` under the `taskRootFolder`
	const folderPairs = findMatchingFolderPairs(
		plugin,
		plugin.app.vault,
		taskRootFolder,
		searchFolderName,
		doneFolderName
	);

	if (Object.keys(folderPairs).length === 0) {
		new Notice(`No matching folder pairs for "${searchFolderName}" and "${doneFolderName}" found in "${taskRootFolder}".`);
		return;
	}

	// Retrieve tasks from `searchFolders`
	const tasks = await fetchObsidianTasks(plugin, tag);
	const filteredTasks = tasks.filter(task =>
		Object.values(folderPairs).some(({ searchPath }) => task.file.path.startsWith(searchPath))
	);

	if (filteredTasks.length === 0) {
		new Notice("No tasks found to sync.");
		return;
	}

	const calendar = google.calendar({ version: "v3", auth: plugin.oAuth2Client });
	let processedCount = 0;
	const errorLogs: string[] = [];

	const lastSyncDate = plugin.settings.lastSyncDate ? new Date(plugin.settings.lastSyncDate) : null;

	const tasksToProcess = isQuickSync && lastSyncDate
		? filteredTasks.filter(task => {
			const createdTime = task.file.stat.ctime;
			const modifiedTime = task.file.stat.mtime;
			return createdTime > lastSyncDate.getTime() || modifiedTime > lastSyncDate.getTime();
		})
		: filteredTasks;

	const totalTasks = tasksToProcess.length;
	if (totalTasks === 0) {
		new Notice("No tasks to sync after filtering.");
		return;
	}

	const progressNotice = new Notice(`Processing tasks: 0 / ${totalTasks} tasks processed`, 0);

	for (const task of tasksToProcess) {
		try {
			debugLog(plugin, `Processing task "${task.name}" with googleEventId: ${task.data.googleEventId}`);

			let matchingEvent: GaxiosResponse<calendar_v3.Schema$Event> | null = null;

			// Retrieve existing Google event if googleEventId is set
			if (task.data.googleEventId) {
				try {
					matchingEvent = await calendar.events.get({
						calendarId: "primary",
						eventId: task.data.googleEventId,
					});
				} catch (error) {
					if (error.code === 404) {
						debugLog(plugin, `No matching event found for "${task.name}". A new event will be created.`);
					} else {
						throw error;
					}
				}
			}

			// Check if task status indicates it should be deleted
			debugLog(plugin, `Task status: ${task.data[plugin.settings.fieldMappings.status]}, Delete status: ${plugin.settings.deleteStatus}`);
			if (task.data[plugin.settings.fieldMappings.status]?.trim() === plugin.settings.deleteStatus.trim()) {

				// Delete event and move task to the corresponding `doneFolder`
				if (task.data.googleEventId) {
					await deleteEvent(plugin, task.data.googleEventId);
					delete task.data.googleEventId; // Properly remove googleEventId field
					await saveTaskDataToYaml(plugin, task.file, task.data); // Update YAML without googleEventId
				}

				await saveTaskDataToYaml(plugin, task.file, task.data);

				// Find the specific `doneFolder` for the task’s `searchFolder`
				const parentPath = Object.keys(folderPairs).find(parent => task.file.path.startsWith(folderPairs[parent].searchPath));
				if (parentPath) {
					await moveTaskToFolder(plugin, task.file, folderPairs[parentPath].donePath);
					debugLog(plugin, `Task "${task.name}" moved to "${doneFolderName}" and event deleted.`);
				} else {
					console.warn(`Matching done folder not found for task "${task.name}".`);
				}
				continue;
			}

			// Create or update event if task is not marked with deleteStatus
			if (matchingEvent) {
				await syncTaskToEvent(plugin, task, matchingEvent.data);
			} else {
				await createEventForTask(plugin, task);
			}

			processedCount++;
			progressNotice.setMessage(`Processing tasks: ${processedCount} / ${totalTasks} tasks processed`);
		} catch (error) {
			processedCount++;
			progressNotice.setMessage(`Processing tasks: ${processedCount} / ${totalTasks} tasks processed`);
			errorLogs.push(`Error processing task "${task.file.path}": ${error.message}`);
			console.error(`Error processing task "${task.file.path}": ${error.message}`);
		}
	}

	progressNotice.setMessage(`Successfully processed ${totalTasks} tasks.`);
	setTimeout(() => progressNotice.hide(), 3000);

	if (errorLogs.length > 0) {
		new Notice("Sync completed with errors. Check console for details.");
		console.error("Error logs:", errorLogs);
	} else {
		new Notice("Sync completed successfully.");
	}

	// Update the last sync date
	plugin.settings.lastSyncDate = new Date().toISOString();
	await saveSettings(plugin, plugin.settings);
}


export async function syncTaskToEvent(plugin: GoogleCalendarTaskSync, task: any, event: calendar_v3.Schema$Event) {
	const calendar = google.calendar({ version: 'v3', auth: plugin.oAuth2Client });
	try {
		const updatedEvent = await mapYamlToEvent(plugin, task.data, task.file);
		updatedEvent.id = event.id;  // Ensure we are updating the same event by ID

		await calendar.events.update({
			calendarId: 'primary',
			eventId: event.id!,
			resource: updatedEvent,
		});
	} catch (error) {
		throw new Error(`Error updating event for task ${task.file.basename}: ${error.message}`);
	}
}
