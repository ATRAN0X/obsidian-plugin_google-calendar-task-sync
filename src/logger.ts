import ExtendedGoogleCalendarSync from './main';
import fs from "fs";

export function debugLog(plugin: ExtendedGoogleCalendarSync, message: string): void {
  if (plugin.settings && plugin.settings.debugMode) {
    console.log(`[DEBUG]: ${message}`);
  }
}

export async function writeErrorLogs(filePath: string, logs: string[]) {
	const content = logs.join('\n\n');
	await fs.promises.writeFile(filePath, content, 'utf-8');
}
