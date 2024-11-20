import {Notice} from 'obsidian';
import GoogleCalendarTaskSync from './main';
import {decryptData} from "./encryptionHandler";
import {debugLog} from "./logger";

export interface PluginSettings {
  tokenData?: any;
  fieldMappings: {
    start: string;
    end: string;
    name: string;
    description?: string;
    location?: string;
    status?: string;
    [key: string]: string | undefined;
  };
  deleteStatus: string;
  logFilePath: string;
  taskFolderPath: string;     // Root task folder
  searchFolderName: string;   // Specific folder within task root to search
  doneFolderName: string;     // Folder for moved completed tasks
  lastSyncDate?: string;
  debugMode: boolean;         // Toggle for debug mode
}

export const DEFAULT_SETTINGS: PluginSettings = {
	fieldMappings: {
		start: 'due',
		end: 'due',
		name: 'name',
		description: '',
		location: '',
		status: '',
		attendees: '',
		colorId: '',
		reminders: '',
		recurrence: '',
		visibility: '',
	},
	deleteStatus: '🟢 DONE',
	logFilePath: '',
	taskFolderPath: 'Tasks',        // Default root folder for tasks
	searchFolderName: 'OPEN',       // Default subfolder to search within taskFolderPath
	doneFolderName: 'DONE',         // Default subfolder for completed tasks within taskFolderPath
	debugMode: false,               // Default debug mode is off
};

// Load settings with decryption
export async function loadSettings(plugin: GoogleCalendarTaskSync, defaults: PluginSettings): Promise<PluginSettings> {
    const data = await plugin.loadData();

    // Mische geladene Daten mit den Standardwerten
    const settings = Object.assign({}, defaults, data) as PluginSettings;

    return settings;
}

// Save settings with encryption
export async function saveSettings(plugin: GoogleCalendarTaskSync, settings: PluginSettings): Promise<void> {
    try {
        await plugin.saveData(settings);
    } catch (error) {
        console.error('Failed to save settings:', error);
        throw error;
    }
}
