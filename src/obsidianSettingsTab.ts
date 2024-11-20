import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import {DEFAULT_SETTINGS, PluginSettings, saveSettings} from "./settings";
import { authenticateWithGoogle, initializeOAuthClient } from "./oauth";
import { deleteAllGoogleEventsFromTasks } from "./taskAndEventOperators";
import ExtendedGoogleCalendarSync from "./main";
import { decryptData, encryptData } from "./encryptionHandler";

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

    // Setting for Client ID
    new Setting(containerEl)
      .setName('Client ID')
      .setDesc('Set your Google API client ID.')
      .addText(text =>
        text
          .setPlaceholder('Enter Client ID')
          .setValue(this.plugin.settings.clientId || '')
          .onChange(async (value) => {
            this.plugin.settings.clientId = encryptData(this.plugin, value);
          })
      );

    // Setting for Client Secret
    new Setting(containerEl)
      .setName('Client Secret')
      .setDesc('Set your Google API client secret.')
      .addText(text =>
        text
          .setPlaceholder('Enter Client Secret')
          .setValue(this.plugin.settings.clientSecret || '')
          .onChange(async (value) => {
            this.plugin.settings.clientSecret = encryptData(this.plugin, value);
          })
      );

	// Save Credentials Button
	new Setting(containerEl)
	  .setName("Save Credentials")
	  .setDesc("Click to encrypt and save Client ID and Client Secret.")
	  .addButton(button => {
		button.setButtonText("Save")
		  .setCta()
		  .onClick(async () => {
			try {
			  const { clientId, clientSecret } = this.plugin.settings;
			  if (!clientId || !clientSecret) {
				new Notice("Both Client ID and Client Secret must be set before saving.");
				return;
			  }

			  // Save sensitive fields
			  await saveSettings(this.plugin, this.plugin.settings);
			  new Notice("Client ID and Client Secret saved successfully.");

			  // Reload the plugin
			  await this.plugin.unload();
			  await this.plugin.onload();

			  // Automatically re-open the settings tab
			  const pluginId = this.plugin.manifest.id;
			  this.app.setting.open();
			  const pluginTab = this.app.setting.activeTab;
			  if (pluginTab && pluginTab.id === pluginId) {
				  this.app.setting.openTabById(pluginId);
			  }

			} catch (error) {
			  console.error("Failed to save credentials:", error);
			  new Notice("Failed to save credentials. Check the console for details.");
			}
		  });
	  });


    // Authenticate with Google Button
    new Setting(containerEl)
      .setName('Authenticate with Google')
      .setDesc('Click the button to authenticate with Google and allow access to your Google Calendar.')
      .addButton(button => {
        button.setButtonText('Authenticate');
        button.onClick(() => authenticateWithGoogle(this.plugin));
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
