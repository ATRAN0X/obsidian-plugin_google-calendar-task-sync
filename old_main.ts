import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

interface PluginSettings {
  clientId: string;
  clientSecret: string;
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
  taskFolderPath: string;
  lastSyncDate?: string; // New field for last sync date
}

const DEFAULT_SETTINGS: PluginSettings = {
  clientId: '',
  clientSecret: '',
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
    // Add other optional fields here
  },
  deleteStatus: '🟢 DONE',
  logFilePath: '', // Default: root folder if not set
  taskFolderPath: 'Tasks', // Standardordner für Tasks
};

export default class ExtendedGoogleCalendarSync extends Plugin {
  settings: PluginSettings;
  oAuth2Client: OAuth2Client;
  tokenFilePath: string;
  redirectUri = 'http://localhost:4000';
  server?: http.Server;

  async onload() {
    await this.loadSettings();
    const vaultPath = (this.app.vault.adapter as any).basePath;
    this.tokenFilePath = path.join(vaultPath, '.obsidian', 'plugins', this.manifest.id, 'data.json');

    this.addSettingTab(new GoogleCalendarSettingTab(this.app, this));

    // Initialize OAuth client with settings
    this.initializeOAuthClient();

    // Register Quick Sync command
	this.addCommand({
	  id: 'quick-sync-obsidian-to-google',
	  name: 'Quick Sync Obsidian Tasks to Google Calendar',
	  callback: () => this.syncGoogleCalendarWithObsidian('task', true),
	});

	// Register Full Sync command
	this.addCommand({
	  id: 'full-sync-obsidian-to-google',
	  name: 'Full Sync Obsidian Tasks to Google Calendar',
	  callback: () => this.syncGoogleCalendarWithObsidian('task', false),
	});

  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Check the structure of fieldMappings and reassign defaults if necessary
    if (typeof this.settings.fieldMappings !== 'object' || Array.isArray(this.settings.fieldMappings)) {
      this.settings.fieldMappings = DEFAULT_SETTINGS.fieldMappings;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  initializeOAuthClient() {
    if (!this.settings.clientId || !this.settings.clientSecret) {
      new Notice('Please set your Google API client ID and secret in the settings.');
      console.error('Missing Client ID or Client Secret');
      return;
    }

    this.oAuth2Client = new google.auth.OAuth2(this.settings.clientId, this.settings.clientSecret, this.redirectUri);
    if (this.settings.tokenData) {
      this.oAuth2Client.setCredentials(this.settings.tokenData);
    }
  }

  async mapYamlToEvent(taskData: any, file: TFile): Promise<calendar_v3.Schema$Event> {
    const mappings = this.settings.fieldMappings;
    const event: calendar_v3.Schema$Event = {};

    const startDate = taskData[mappings.start] ? new Date(taskData[mappings.start]) : new Date();
    const endDate = taskData[mappings.end] ? new Date(taskData[mappings.end]) : new Date();

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error(`Invalid time value for start (${taskData[mappings.start]}) or end (${taskData[mappings.end]})`);
    }

    const isAllDayEvent = taskData[mappings.start].length === 10 && taskData[mappings.end].length === 10;
    if (isAllDayEvent) {
      event.start = { date: startDate.toISOString().split('T')[0] };
      event.end = { date: endDate.toISOString().split('T')[0] };
    } else {
      event.start = { dateTime: startDate.toISOString() };
      event.end = { dateTime: endDate.toISOString() };
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
      event.description = await this.app.vault.read(file);
    }

    if (taskData.googleEventId) {
      event.id = taskData.googleEventId;
    }

    return event;
  }

  getLogFilePath(vaultPath: string, logFilePath: string): string {
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

  async syncGoogleCalendarWithObsidian(tag: string = 'task', isQuickSync: boolean = false) {
		if (!this.settings.tokenData) {
			new Notice('Please authenticate with Google first.');
			return;
		}

		const vaultPath = (this.app.vault.adapter as any).basePath;
		const logFilePath = this.getLogFilePath(vaultPath, this.settings.logFilePath);

		let processedCount = 0;
		const errorLogs: string[] = [];

		// Fetch last sync date for quick sync
		const lastSyncDate = this.settings.lastSyncDate ? new Date(this.settings.lastSyncDate) : null;

		// Fetch tasks and filter by last modified date for quick sync
		let tasks = await this.fetchObsidianTasks(tag);
		if (isQuickSync && lastSyncDate) {
			tasks = tasks.filter(task => {
				const modifiedTime = task.file.stat.mtime;
				return modifiedTime > lastSyncDate.getTime() && task.data.googleEventId && task.data[this.settings.fieldMappings.status] !== this.settings.deleteStatus;
			});
		}

		const totalTasks = tasks.length;
		if (totalTasks === 0) {
			new Notice('No tasks found to sync.');
			return;
		}

		const progressNotice = new Notice(`Processing tasks: 0 / ${totalTasks} tasks processed`, 0);
		const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });

		try {
			for (const task of tasks) {
				try {
					// Processing tasks
					console.log(`Debug: Processing task "${task.name}" with googleEventId: ${task.data.googleEventId}`);
					let matchingEvent = null;

					// Try to get existing event if googleEventId is present
					if (task.data.googleEventId) {
						try {
							matchingEvent = await calendar.events.get({
								calendarId: 'primary',
								eventId: task.data.googleEventId,
							});
						} catch (error) {
							if (error.code === 404) {
								console.log(`Debug: No matching event found for "${task.name}". A new event will be created.`);
							} else {
								throw error;
							}
						}
					}

					// If status requires deletion, delete event and continue
					if (task.data[this.settings.fieldMappings.status] === this.settings.deleteStatus && task.data.googleEventId) {
						await this.deleteEvent(task.data.googleEventId);
						continue;
					} else if (matchingEvent) {
						// Update existing event
						await this.syncTaskToEvent(task, matchingEvent.data);
					} else {
						// Create new event
						await this.createEventForTask(task);
					}

					processedCount++;
					progressNotice.setMessage(`Processing tasks: ${processedCount} / ${totalTasks} tasks processed`);
				} catch (error) {
					processedCount++;
					progressNotice.setMessage(`Processing tasks: ${processedCount} / ${totalTasks} tasks processed`);
					const errorEntry = `- **File**: ${task.file.path}\n  **Error**: ${error.message}`;
					errorLogs.push(errorEntry);
					console.error(`Error processing task "${task.file.path}": ${error.message}`);
				}
			}

			progressNotice.setMessage(`Successfully processed ${totalTasks} tasks.`);
			setTimeout(() => progressNotice.hide(), 3000);

			if (errorLogs.length > 0) {
				const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
				const logFilePathWithTimestamp = logFilePath.replace(/(\.md)$/, `_${timestamp}$1`);
				await this.writeErrorLogs(logFilePathWithTimestamp, errorLogs);
				new Notice(`Sync completed with errors. Check log file at: ${logFilePathWithTimestamp}`);
			} else {
				new Notice('Sync completed successfully.');
			}

			// Update last sync date on successful completion of sync
			this.settings.lastSyncDate = new Date().toISOString();
			await this.saveSettings();

		} catch (error) {
			console.error('Error syncing tasks:', error.message);
			new Notice(`Failed to sync tasks. Error: ${error.message}`);
		}

		// Update last sync date on successful completion of sync
		this.settings.lastSyncDate = new Date().toISOString();
		await this.saveSettings();
  }

  async deleteEvent(eventId: string) {
	  const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
	  try {
		await calendar.events.delete({
		  calendarId: 'primary',
		  eventId: eventId,
		});
		console.log(`Successfully deleted event with ID: ${eventId}`);
	  } catch (error) {
		throw new Error(`Failed to delete event with ID: ${eventId}: ${error.message}`);
	  }
	}

  async syncTaskToEvent(task: any, event: calendar_v3.Schema$Event) {
  	const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
  	try {
  		const updatedEvent = await this.mapYamlToEvent(task.data, task.file);
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

  async createEventForTask(task: any) {
  	const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
  	try {
  		const event = await this.mapYamlToEvent(task.data, task.file);

  		const createdEvent = await calendar.events.insert({
  			calendarId: 'primary',
  			resource: event,
  		});

  		// Speichere die Event-ID zurück in die YAML-Frontmatter des Tasks
  		task.data.googleEventId = createdEvent.data.id;
  		await this.saveTaskDataToYaml(task.file, task.data);
  	} catch (error) {
  		throw new Error(`Error creating event for task ${task.file.basename}: ${error.message}`);
  	}
  }

  async fetchObsidianTasks(tag: string): Promise<any[]> {
    const tasks: any[] = [];
    const vaultPath = (this.app.vault.adapter as any).basePath;
    const taskFolderPath = this.settings.taskFolderPath || 'Tasks';
    const fullTaskFolderPath = path.join(vaultPath, taskFolderPath);

    // Debug-Ausgabe für den Pfad
    console.log("Debug: Verwendeter Task-Ordner:", fullTaskFolderPath);

    // Überprüfe, ob der Ordner existiert, bevor wir fortfahren
    if (!fs.existsSync(fullTaskFolderPath)) {
        console.log("Debug: Der Task-Ordner existiert nicht:", fullTaskFolderPath);
        return tasks; // Geben Sie ein leeres Array zurück, falls der Ordner nicht existiert
    }

    const markdownFiles = this.app.vault.getMarkdownFiles();

    // Filtere nur Dateien, die im angegebenen oder Standardordner starten
    const taskFiles = markdownFiles.filter(file => file.path.startsWith(taskFolderPath));

    if (taskFiles.length === 0) {
        console.log("Debug: Keine Markdown-Dateien im Task-Ordner gefunden:", taskFolderPath);
    } else {
        console.log(`Debug: ${taskFiles.length} Dateien im Task-Ordner gefunden`);
    }

    for (const file of taskFiles) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter && cache.frontmatter.tags?.includes(tag)) {
            tasks.push({
                name: file.basename,
                data: cache.frontmatter,
                file: file,
            });
        }
    }

    console.log(`Debug: ${tasks.length} Tasks mit Tag "${tag}" gefunden.`);
    return tasks;
  }

  async deleteAllGoogleEventsFromTasks(): Promise<void> {
    // Always process files to remove googleEventId regardless of Google Calendar events
    this.logInfo('Processing vault files to remove Google Calendar event IDs...');
    await this.processVaultFiles();

    const eventsToDelete = await this.getGoogleCalendarEvents();
    const totalEvents = eventsToDelete.length;
    const progressNotice = new Notice(`Deleting 0 of ${totalEvents} events...`, 0);

    for (let i = 0; i < totalEvents; i++) {
      await this.deleteEventAndRemoveField(eventsToDelete[i]);
      progressNotice.setMessage(`Deleting ${i + 1} of ${totalEvents} events...`);
    }

    progressNotice.setMessage(`Successfully deleted ${totalEvents} events.`);
    setTimeout(() => progressNotice.hide(), 3000);
  }

  async getGoogleCalendarEvents(): Promise<calendar_v3.Schema$Event[]> {
    const auth = new google.auth.OAuth2(this.settings.clientId, this.settings.clientSecret);
    auth.setCredentials(this.settings.tokenData);

    const calendar = google.calendar({ version: 'v3', auth });

    const response = await calendar.events.list({
      calendarId: 'primary',
      maxResults: 2500,
    });

    return response.data.items || [];
  }

  async deleteEventAndRemoveField(event: calendar_v3.Schema$Event): Promise<void> {
    const auth = new google.auth.OAuth2(this.settings.clientId, this.settings.clientSecret);
    auth.setCredentials(this.settings.tokenData);

    const calendar = google.calendar({ version: 'v3', auth });

    // Delete the event from Google Calendar
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: event.id!,
    });

    // Log information about the deleted event
    this.logInfo(`Deleted Google Calendar event: ${event.id}`);

    // Process vault files and remove googleEventId field if found
    await this.processVaultFiles(event.id!);
  }

  async processVaultFiles(googleEventId?: string): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      if (googleEventId) {
        await this.removeGoogleEventIdField(file, googleEventId);
      } else {
        await this.removeGoogleEventIdField(file);
      }
    }
  }

  async removeGoogleEventIdField(file: TFile, googleEventId?: string): Promise<void> {
    const content = await this.app.vault.read(file);
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

        await this.app.vault.modify(file, updatedContent);
        this.logInfo(`Updated file: ${file.path} - Removed googleEventId`);
      }
    }
  }

  logInfo(message: string): void {
    console.log(`plugin:extended-google-calendar-sync: ${message}`);
  }

  async saveTaskDataToYaml(file: TFile, data: any) {
    const yamlContent = `---\n${Object.entries(data)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')}\n---\n`;

    const fileContent = await this.app.vault.read(file);
    const existingYamlEndIndex = fileContent.indexOf('---', 3);
    const updatedContent = `${yamlContent}\n${fileContent
      .slice(existingYamlEndIndex + 3)
      .trim()}`;

    await this.app.vault.modify(file, updatedContent);
  }

  getAuthUrl(): string {
    return this.oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar'],
    });
  }

  async authenticateWithGoogle() {
    if (!this.settings.clientId || !this.settings.clientSecret) {
      new Notice('Please set your Google API client ID and secret in the settings.');
      return;
    }

    const authUrl = this.getAuthUrl();
    window.open(authUrl, '_blank');
    new Notice('Authentication started. Please check your browser to continue.');

    if (this.server) {
      this.server.close();
    }

    this.server = http.createServer(async (req, res) => {
      if (req.url && req.url.startsWith('/?code=')) {
        const code = new URL(req.url, 'http://localhost:4000').searchParams.get('code');
        res.end('Authentication successful! You can close this window.');
        this.server?.close();

        if (code) {
          try {
            const { tokens } = await this.oAuth2Client.getToken(code);
            this.oAuth2Client.setCredentials(tokens);
            this.settings.tokenData = tokens;
            await this.saveSettings();
            new Notice('Google Calendar API authorized successfully and token saved.');
          } catch (error) {
            console.error('Error getting token:', error);
            new Notice('Failed to exchange code for tokens.');
          }
        }
      }
    });

    this.server.listen(4000, () => {
      console.log('Server listening on http://localhost:4000');
    });
  }

  async writeErrorLogs(filePath: string, logs: string[]) {
    const content = logs.join('\n\n');
    await fs.promises.writeFile(filePath, content, 'utf-8');
  }
}

class GoogleCalendarSettingTab extends PluginSettingTab {
  plugin: ExtendedGoogleCalendarSync;

  constructor(app: App, plugin: ExtendedGoogleCalendarSync) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl('h2', { text: 'Settings for Google Calendar Sync' });

    new Setting(containerEl)
      .setName('Client ID')
      .setDesc('Set your Google API client ID.')
      .addText(text =>
        text
          .setPlaceholder('Enter Client ID')
          .setValue(this.plugin.settings.clientId || '')
          .onChange(async (value) => {
            this.plugin.settings.clientId = value;
            await this.plugin.saveSettings();
            this.plugin.initializeOAuthClient();
          })
      );

    new Setting(containerEl)
      .setName('Client Secret')
      .setDesc('Set your Google API client secret.')
      .addText(text =>
        text
          .setPlaceholder('Enter Client Secret')
          .setValue(this.plugin.settings.clientSecret || '')
          .onChange(async (value) => {
            this.plugin.settings.clientSecret = value;
            await this.plugin.saveSettings();
            this.plugin.initializeOAuthClient();
          })
      );

    new Setting(containerEl)
      .setName('Authenticate with Google')
      .setDesc('Click the button to authenticate with Google and allow access to your Google Calendar.')
      .addButton(button => {
        button.setButtonText('Authenticate');
        button.onClick(() => this.plugin.authenticateWithGoogle());
      });

    const fieldMappingsSetting = containerEl.createEl('details', { cls: 'collapsible' });
    fieldMappingsSetting.createEl('summary', { text: 'Field Mappings' });

    // Function to create field mapping settings dynamically
    const createFieldMappingSetting = (container: HTMLElement, field: keyof PluginSettings['fieldMappings'], label: string, defaultValue: string) => {
      new Setting(container)
        .setName(label)
        .setDesc(`Map to the ${label.toLowerCase()} of the event.`)
        .addText(text =>
          text
            .setPlaceholder(`Enter YAML field name for ${label.toLowerCase()} (default: ${defaultValue})`)
            .setValue(this.plugin.settings.fieldMappings[field] || '')
            .onChange(async (value) => {
              this.plugin.settings.fieldMappings[field] = value || defaultValue;
              await this.plugin.saveSettings();
            })
        );
    };

    // Mandatory fields mappings
    createFieldMappingSetting(fieldMappingsSetting, 'start', 'Start Time', DEFAULT_SETTINGS.fieldMappings.start);
    createFieldMappingSetting(fieldMappingsSetting, 'end', 'End Time', DEFAULT_SETTINGS.fieldMappings.end);
    createFieldMappingSetting(fieldMappingsSetting, 'name', 'Summary', DEFAULT_SETTINGS.fieldMappings.name);

    // Optional fields mappings
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
            await this.plugin.saveSettings();
          })
      );

	new Setting(containerEl)
      .setName('Task Folder Path')
      .setDesc('Specify the folder path for tasks to sync with Google Calendar (relative to vault).')
      .addText(text =>
        text
          .setPlaceholder('Enter task folder path')
          .setValue(this.plugin.settings.taskFolderPath || 'Tasks')
          .onChange(async (value) => {
            this.plugin.settings.taskFolderPath = value || 'Tasks';
            await this.plugin.saveSettings();
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
            await this.plugin.saveSettings();
          })
      );

	new Setting(containerEl)
      .setName('Delete All Google Events from Tasks')
      .setDesc('Click the button to delete all Google Calendar events derived from tasks.')
      .addButton(button => button
        .setButtonText('Delete All Events')
        .setCta()
        .onClick(async () => {
          await this.plugin.deleteAllGoogleEventsFromTasks();
          new Notice('All Google Calendar events derived from tasks have been deleted.');
        }));

	    // Add a save settings button
    new Setting(containerEl)
      .addButton(button =>
        button
          .setButtonText('Save Settings')
          .setCta()
          .onClick(async () => {
            await this.plugin.saveSettings();
            new Notice('Settings saved');
          })
      );
  }
}
