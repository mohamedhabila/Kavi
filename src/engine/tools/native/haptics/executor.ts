export async function executeHapticFeedback(args: { type?: string }): Promise<string> {
  try {
    const Haptics = await import('expo-haptics');
    const type = args.type || 'medium';

    switch (type) {
      case 'light':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'heavy':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'success':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'error':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
      case 'medium':
      default:
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
    }

    return JSON.stringify({ status: 'triggered', type });
  } catch (err: unknown) {
    return JSON.stringify({
      error: `Haptic feedback failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
