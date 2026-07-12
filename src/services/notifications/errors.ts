export class NotificationPermissionDeniedError extends Error {
  constructor() {
    super('Notification permission denied');
    this.name = 'NotificationPermissionDeniedError';
  }
}

export function isPermanentLocalNotificationError(error: unknown): boolean {
  return error instanceof NotificationPermissionDeniedError;
}
