import { AES, SHA256, enc } from "crypto-js";
import os from "os";
import { debugLog } from "./logger";
import GoogleCalendarTaskSync from "./main";

// Generate a system-specific encryption key
export function getSystemEncryptionKey(plugin: GoogleCalendarTaskSync): string {
  const userInfo = os.userInfo().username; // Get the system username
  const platform = os.platform(); // Get the platform type
  const keySource = `${userInfo}-${platform}`; // Combine user and platform info
  const key = SHA256(keySource).toString(); // Generate a hashed key

  if (plugin.settings) {
    debugLog(plugin, `Generated encryption key: ${key}`);
  }

  return key;
}

// Encrypt data using the system-specific encryption key
export function encryptData(plugin: GoogleCalendarTaskSync, data: string): string {
  try {
    const encryptionKey = getSystemEncryptionKey(plugin); // Retrieve the key
    const encryptedData = AES.encrypt(data, encryptionKey).toString(); // Encrypt the data
    debugLog(plugin, `Data successfully encrypted.`);
    return encryptedData;
  } catch (error) {
    debugLog(plugin, `Failed to encrypt data: ${error.message}`);
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

// Decrypt data using the system-specific encryption key
export function decryptData(plugin: GoogleCalendarTaskSync, encryptedData: string): string {
  try {
    const encryptionKey = getSystemEncryptionKey(plugin);
    debugLog(plugin, `Attempting to decrypt data: ${encryptedData}`);

    const decryptedBytes = AES.decrypt(encryptedData, encryptionKey);
    const decryptedData = decryptedBytes.toString(enc.Utf8);

    if (!decryptedData) {
      throw new Error("Decryption returned empty data. Possible incorrect key.");
    }

    debugLog(plugin, `Data successfully decrypted.`);
    return decryptedData;
  } catch (error) {
    debugLog(plugin, `Failed to decrypt data: ${error.message}`);
    throw new Error(`Decryption failed: ${error.message}`);
  }
}
