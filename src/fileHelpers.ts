import {Notice, TFile, TFolder, Vault} from "obsidian";
import {calendar_v3} from "googleapis";
import ExtendedGoogleCalendarSync from "./main";
import * as path from 'path';
import * as fs from 'fs';
import {debugLog} from "./logger";


export async function mapYamlToEvent(plugin: ExtendedGoogleCalendarSync, taskData: any, file: TFile): Promise<calendar_v3.Schema$Event> {
	const mappings = plugin.settings.fieldMappings;
	const event: calendar_v3.Schema$Event = {};

	const startDate = taskData[mappings.start] ? new Date(taskData[mappings.start]) : new Date();
	const endDate = taskData[mappings.end] ? new Date(taskData[mappings.end]) : new Date();

	if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
		throw new Error(`Invalid time value for start (${taskData[mappings.start]}) or end (${taskData[mappings.end]})`);
	}

	const isAllDayEvent = taskData[mappings.start].length === 10 && taskData[mappings.end].length === 10;
	if (isAllDayEvent) {
		event.start = {date: startDate.toISOString().split('T')[0]};
		event.end = {date: endDate.toISOString().split('T')[0]};
	} else {
		event.start = {dateTime: startDate.toISOString()};
		event.end = {dateTime: endDate.toISOString()};
	}

	event.summary = taskData[mappings.name] || file.basename;

	// Optional fields, only included if they are set
	if (mappings.description && taskData[mappings.description]) {
		event.description = taskData[mappings.description];
	}
	if (mappings.location && taskData[mappings.location]) {
		event.location = taskData[mappings.location];
	}
	if (mappings.attendees && taskData[mappings.attendees]) {
		event.attendees = JSON.parse(taskData[mappings.attendees]);
	}
	if (mappings.colorId && taskData[mappings.colorId]) {
		event.colorId = taskData[mappings.colorId];
	}
	if (mappings.reminders && taskData[mappings.reminders]) {
		event.reminders = JSON.parse(taskData[mappings.reminders]);
	}
	if (mappings.recurrence && taskData[mappings.recurrence]) {
		event.recurrence = taskData[mappings.recurrence].split(',');
	}
	if (mappings.visibility && taskData[mappings.visibility]) {
		event.visibility = taskData[mappings.visibility];
	}

	if (file) {
		event.description = await plugin.app.vault.read(file);
	}

	if (taskData.googleEventId) {
		event.id = taskData.googleEventId;
	}

	return event;
}

export function getLogFilePath(vaultPath: string, logFilePath: string): string {
	// Kombiniere den Vault-Pfad mit dem benutzerdefinierten Pfad
	const folderPath = path.join(vaultPath, logFilePath || 'Logs');

	// Überprüfe, ob der Ordner existiert, und erstelle ihn, falls notwendig
	if (!fs.existsSync(folderPath)) {
	  fs.mkdirSync(folderPath, { recursive: true });
	}

	// Erstelle einen Dateinamen basierend auf Datum und Uhrzeit
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const fileName = `log_${timestamp}.md`;

	// Kombiniere den Ordnerpfad mit dem dynamischen Dateinamen
	return path.join(folderPath, fileName);
}

export function logInfo(message: string): void {
	console.log(`plugin:extended-google-calendar-sync: ${message}`);
}

export async function saveTaskDataToYaml(plugin: ExtendedGoogleCalendarSync, file: TFile, data: any) {
	const yamlContent = `---\n${Object.entries(data)
	  .map(([key, value]) => `${key}: ${value}`)
	  .join('\n')}\n---\n`;

	const fileContent = await plugin.app.vault.read(file);
	const existingYamlEndIndex = fileContent.indexOf('---', 3);
	const updatedContent = `${yamlContent}\n${fileContent
	  .slice(existingYamlEndIndex + 3)
	  .trim()}`;

	await plugin.app.vault.modify(file, updatedContent);
}

export async function moveTaskToFolder(
  plugin: ExtendedGoogleCalendarSync,
  file: TFile,
  targetFolderPath: string // already defined relative to the vault root
) {
  // Create the target folder if it doesn't exist
  if (!(await plugin.app.vault.adapter.exists(targetFolderPath))) {
    await plugin.app.vault.adapter.mkdir(targetFolderPath);
  }

  // Define the file path in the target folder
  const targetFilePath = path.join(targetFolderPath, file.name);

  // Move the file
  try {
    await plugin.app.vault.rename(file, targetFilePath);
    debugLog(plugin, `Task "${file.name}" successfully moved to "${targetFolderPath}"`);
  } catch (error) {
    console.error(`Failed to move task "${file.name}" to "${targetFolderPath}":`, error);
    new Notice(`Error moving file "${file.name}" to "${targetFolderPath}".`);
    throw error;
  }
}

// Function to identify folder pairs within the task root folder
export function findMatchingFolderPairs(
  vault: Vault,
  rootFolderPath: string,
  searchFolderName: string,
  doneFolderName: string
): Record<string, { searchPath: string; donePath: string }> {
  const folderPairs: Record<string, { searchPath: string; donePath: string }> = {};

  // Recursive helper function
  function recurseFolder(folder: TFolder) {
    // Check if we find an `OPEN` or `DONE` folder within the same parent directory
    const parentPath = path.dirname(folder.path);

    if (folder.name === searchFolderName) {
      if (!folderPairs[parentPath]) {
        folderPairs[parentPath] = {} as any;
      }
      folderPairs[parentPath].searchPath = folder.path;
    } else if (folder.name === doneFolderName) {
      if (!folderPairs[parentPath]) {
        folderPairs[parentPath] = {} as any;
      }
      folderPairs[parentPath].donePath = folder.path;
    }

    // Recursively search further subfolders
    folder.children.forEach(child => {
      if (child instanceof TFolder) {
        recurseFolder(child);
      }
    });
  }

  const rootFolder = vault.getAbstractFileByPath(rootFolderPath);
  if (rootFolder instanceof TFolder) {
    recurseFolder(rootFolder);
  }

  // Return only entries where both a `searchPath` and a `donePath` are defined
  return Object.fromEntries(Object.entries(folderPairs).filter(([, paths]) => paths.searchPath && paths.donePath));
}
