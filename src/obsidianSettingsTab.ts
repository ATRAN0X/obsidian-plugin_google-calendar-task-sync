import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import {DEFAULT_SETTINGS, PluginSettings, saveSettings} from "./settings";
import { authenticateWithGoogle, initializeOAuthClient } from "./oauth";
import { deleteAllGoogleEventsFromTasks } from "./taskAndEventOperators";
import ExtendedGoogleCalendarSync from "./main";
import { decryptData, encryptData } from "./encryptionHandler";
import {debugLog} from "./logger";

export class GoogleCalendarSettingTab extends PluginSettingTab {
  plugin: ExtendedGoogleCalendarSync;

  constructor(app: App, plugin: ExtendedGoogleCalendarSync) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async display(): Promise<void> {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl('h2', { text: 'Settings for Google Calendar Sync' });

    // Temporary storage for clientId and clientSecret
    let tempClientId: string = "";
    let tempClientSecret: string = "";

    // Setting for Client ID
    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("Set your Google API client ID (used only for authentication).")
      .addText(text =>
        text
          .setPlaceholder("Enter Client ID")
          .onChange(value => {
            tempClientId = value.trim();
          })
      );

    // Setting for Client Secret
    new Setting(containerEl)
      .setName("Client Secret")
      .setDesc("Set your Google API client secret (used only for authentication).")
      .addText(text =>
        text
          .setPlaceholder("Enter Client Secret")
          .onChange(value => {
            tempClientSecret = value.trim();
          })
      );

    // Save Credentials Button
    new Setting(containerEl)
      .setName("Save and Authenticate")
      .setDesc("Save credentials temporarily and authenticate with Google.")
      .addButton(button => {
        button.setButtonText("Authenticate")
          .setCta()
          .onClick(async () => {
            try {
              if (!tempClientId || !tempClientSecret) {
                new Notice("Both Client ID and Client Secret must be set before proceeding.");
                return;
              }

              // Initialize OAuth client with the provided credentials
              const oAuthClient = initializeOAuthClient(this.plugin, tempClientId, tempClientSecret);
			  if (!oAuthClient) {

				// Clear clientId and clientSecret after authentication
				tempClientId = "";
				tempClientSecret = "";

				new Notice("Failed to initialize OAuth client. Check your credentials.");
                return;
              }

              // Authenticate with Google
              await authenticateWithGoogle(this.plugin);

              // Clear clientId and clientSecret after authentication
              tempClientId = "";
              tempClientSecret = "";
              new Notice("Authentication successful. Tokens have been saved securely.");
            } catch (error) {
              console.error("Authentication error:", error);
              new Notice("Authentication failed. Check the console for more details.");
            }
          });
      });

    const fieldMappingsSetting = containerEl.createEl('details', { cls: 'collapsible' });
    fieldMappingsSetting.createEl('summary', { text: 'Field Mappings' });

    const createFieldMappingSetting = (
      container: HTMLElement,
      field: keyof PluginSettings['fieldMappings'],
      label: string,
      defaultValue: string
    ) => {
      new Setting(container)
        .setName(label)
        .setDesc(`Map to the ${label.toLowerCase()} of the event.`)
        .addText(text =>
          text
            .setPlaceholder(`Enter YAML field name for ${label.toLowerCase()} (default: ${defaultValue})`)
            .setValue(this.plugin.settings.fieldMappings[field] || '')
            .onChange(async (value) => {
              this.plugin.settings.fieldMappings[field] = value || defaultValue;
              await saveSettings(this.plugin, this.plugin.settings);
            })
        );
    };

    createFieldMappingSetting(fieldMappingsSetting, 'start', 'Start Time', DEFAULT_SETTINGS.fieldMappings.start);
    createFieldMappingSetting(fieldMappingsSetting, 'end', 'End Time', DEFAULT_SETTINGS.fieldMappings.end);
    createFieldMappingSetting(fieldMappingsSetting, 'name', 'Summary', DEFAULT_SETTINGS.fieldMappings.name);

    const optionalMappings = ['description', 'location', 'status', 'attendees', 'colorId', 'reminders', 'recurrence', 'visibility'] as const;
    optionalMappings.forEach(field => createFieldMappingSetting(fieldMappingsSetting, field, field.charAt(0).toUpperCase() + field.slice(1), ''));

    new Setting(containerEl)
      .setName('Delete Status Value')
      .setDesc('Enter the status value which will trigger the deletion of the corresponding Google Calendar event.')
      .addText(text =>
        text
          .setPlaceholder('Enter status value to trigger event deletion')
          .setValue(this.plugin.settings.deleteStatus || '')
          .onChange(async (value) => {
            this.plugin.settings.deleteStatus = value;
            await saveSettings(this.plugin, this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName('Task Root Folder')
      .setDesc('Specify the root folder for tasks.')
      .addText(text =>
        text
          .setPlaceholder('Enter root folder name')
          .setValue(this.plugin.settings.taskFolderPath || 'Tasks')
          .onChange(async (value) => {
            this.plugin.settings.taskFolderPath = value || 'Tasks';
            await saveSettings(this.plugin, this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName('Search Folder Name')
      .setDesc('Specify the name of the folder to search within the task root.')
      .addText(text =>
        text
          .setPlaceholder('Enter search folder name')
          .setValue(this.plugin.settings.searchFolderName || 'OPEN')
          .onChange(async (value) => {
            this.plugin.settings.searchFolderName = value || 'OPEN';
            await saveSettings(this.plugin, this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName('Done Folder Name')
      .setDesc('Specify the name of the folder to move tasks when marked as done.')
      .addText(text =>
        text
          .setPlaceholder('Enter done folder name')
          .setValue(this.plugin.settings.doneFolderName || 'DONE')
          .onChange(async (value) => {
            this.plugin.settings.doneFolderName = value || 'DONE';
            await saveSettings(this.plugin, this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName('Log File Path')
      .setDesc('Specify the file path for logging errors (default: root folder if not set).')
      .addText(text =>
        text
          .setPlaceholder('Enter path for log file')
          .setValue(this.plugin.settings.logFilePath || '')
          .onChange(async (value) => {
            this.plugin.settings.logFilePath = value;
            await saveSettings(this.plugin, this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName('Delete All Google Events from Tasks')
      .setDesc('Click the button to delete all Google Calendar events derived from tasks.')
      .addButton(button => button
        .setButtonText('Delete All Events')
        .setCta()
        .onClick(async () => {
          await deleteAllGoogleEventsFromTasks(this.plugin);
          new Notice('All Google Calendar events derived from tasks have been deleted.');
        }));

    new Setting(containerEl)
      .setName("Debug Mode")
      .setDesc("Enable debug mode to display console logs.")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await saveSettings(this.plugin, this.plugin.settings);
        }));
  }
}
