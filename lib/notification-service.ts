import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Check if we're running in Expo Go (SDK 53+ removed remote notifications from Expo Go)
const isExpoGo = Constants.appOwnership === 'expo';

// Configure notification behavior only if not in Expo Go
if (!isExpoGo) {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch (error) {
    console.warn('Notifications not available:', error);
  }
}

export class UploadNotificationService {
  private static instance: UploadNotificationService;
  private notificationId: string | null = null;

  static getInstance(): UploadNotificationService {
    if (!UploadNotificationService.instance) {
      UploadNotificationService.instance = new UploadNotificationService();
    }
    return UploadNotificationService.instance;
  }

  async requestPermissions(): Promise<boolean> {
    if (isExpoGo) {
      console.warn('Notifications not available in Expo Go. Use a development build instead.');
      return false;
    }
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.warn('Failed to request notification permissions:', error);
      return false;
    }
  }

  async showUploadProgress(progress: number, filename?: string): Promise<void> {
    if (isExpoGo) {
      // In Expo Go, just log to console
      console.log(`Uploading: ${filename || 'file'} - ${Math.min(Math.max(progress, 0), 100)}%`);
      return;
    }
    
    try {
      // Cap progress at 100%
      const cappedProgress = Math.min(Math.max(progress, 0), 100);
      
      const title = 'Uploading Video';
      const body = filename 
        ? `Uploading ${filename}... ${cappedProgress}%`
        : `Uploading... ${cappedProgress}%`;

      if (this.notificationId) {
        // Update existing notification
        await Notifications.scheduleNotificationAsync({
          identifier: this.notificationId,
          content: {
            title,
            body,
            data: { progress: cappedProgress, type: 'upload-progress' },
          },
          trigger: null, // Immediate
        });
      } else {
        // Create new notification
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title,
            body,
            data: { progress: cappedProgress, type: 'upload-progress' },
          },
          trigger: null, // Immediate
        });
        this.notificationId = id;
      }
    } catch (error) {
      console.warn('Failed to show upload progress notification:', error);
    }
  }

  async showUploadComplete(filename?: string): Promise<void> {
    if (isExpoGo) {
      console.log(`Upload complete: ${filename || 'file'}`);
      return;
    }
    
    try {
      if (this.notificationId) {
        await Notifications.scheduleNotificationAsync({
          identifier: this.notificationId,
          content: {
            title: 'Upload Complete! 🎉',
            body: filename 
              ? `${filename} has been uploaded successfully`
              : 'Your video has been uploaded successfully',
            data: { type: 'upload-complete' },
          },
          trigger: null,
        });

        // Clear the notification after 3 seconds
        setTimeout(async () => {
          await this.clearNotification();
        }, 3000);
      }
    } catch (error) {
      console.warn('Failed to show upload complete notification:', error);
    }
  }

  async showUploadSuccess(message: string, filename?: string): Promise<void> {
    // Alias for showUploadComplete to maintain backward compatibility
    await this.showUploadComplete(filename);
  }

  async showUploadError(error: string, filename?: string): Promise<void> {
    if (isExpoGo) {
      console.error(`Upload error: ${filename || 'file'} - ${error}`);
      return;
    }
    
    try {
      if (this.notificationId) {
        await Notifications.scheduleNotificationAsync({
          identifier: this.notificationId,
          content: {
            title: 'Upload Failed ❌',
            body: filename 
              ? `Failed to upload ${filename}: ${error}`
              : `Upload failed: ${error}`,
            data: { type: 'upload-error' },
          },
          trigger: null,
        });

        // Clear the notification after 5 seconds
        setTimeout(async () => {
          await this.clearNotification();
        }, 5000);
      }
    } catch (err) {
      console.warn('Failed to show upload error notification:', err);
    }
  }

  async clearNotification(): Promise<void> {
    if (isExpoGo || !this.notificationId) return;
    try {
      await Notifications.dismissNotificationAsync(this.notificationId);
      this.notificationId = null;
    } catch (error) {
      console.warn('Failed to clear notification:', error);
    }
  }

  async cancelAllNotifications(): Promise<void> {
    if (isExpoGo) return;
    try {
      await Notifications.dismissAllNotificationsAsync();
      this.notificationId = null;
    } catch (error) {
      console.warn('Failed to cancel notifications:', error);
    }
  }
}

export const uploadNotificationService = UploadNotificationService.getInstance(); 