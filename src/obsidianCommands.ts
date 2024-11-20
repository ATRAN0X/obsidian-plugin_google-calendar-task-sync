import GoogleCalendarTaskSync from "./main";
import { syncGoogleCalendarWithObsidian } from "./calendarSync"


export function addCommands(plugin: GoogleCalendarTaskSync) {
  plugin.addCommand({
    id: 'quick-sync-obsidian-to-google',
    name: 'Quick Sync Obsidian Tasks to Google Calendar',
    callback: () => syncGoogleCalendarWithObsidian(plugin, 'task', true),
  });

  plugin.addCommand({
    id: 'full-sync-obsidian-to-google',
    name: 'Full Sync Obsidian Tasks to Google Calendar',
    callback: () => syncGoogleCalendarWithObsidian(plugin, 'task', false),
  });
}
