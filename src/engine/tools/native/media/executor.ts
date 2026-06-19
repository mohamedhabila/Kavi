export async function executePhotosLatest(args: { count?: number }): Promise<string> {
  try {
    const MediaLibrary = await import('expo-media-library');
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') return JSON.stringify({ error: 'Media library permission denied' });

    const count = Math.min(args.count || 5, 20);
    const assets = await MediaLibrary.getAssetsAsync({
      first: count,
      sortBy: [MediaLibrary.SortBy.creationTime],
      mediaType: [MediaLibrary.MediaType.photo],
    });

    return JSON.stringify(
      assets.assets.map((a: any) => ({
        id: a.id,
        uri: a.uri,
        filename: a.filename,
        width: a.width,
        height: a.height,
        creationTime: a.creationTime,
        mediaType: a.mediaType,
      })),
    );
  } catch (err: unknown) {
    return JSON.stringify({
      error: `Photos access failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ── Camera Clip Tool ─────────────────────────────────────────────────────

export async function executeCameraClip(args: {
  durationSeconds?: number;
  quality?: string;
  camera?: string;
}): Promise<string> {
  try {
    const ImagePicker = await import('expo-image-picker');
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: args.durationSeconds || 10,
      quality: args.quality === 'high' ? 1 : args.quality === 'low' ? 0.3 : 0.5,
      cameraType:
        args.camera === 'front' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
    });

    if (result.canceled || !result.assets?.[0]) {
      return JSON.stringify({ status: 'cancelled' });
    }

    const asset = result.assets[0];
    return JSON.stringify({
      status: 'recorded',
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      mimeType: asset.mimeType || 'video/mp4',
    });
  } catch (err: unknown) {
    return JSON.stringify({
      error: `Camera clip failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ── Screen Record (Screenshot) Tool ──────────────────────────────────────

export async function executeScreenRecord(args: { format?: string }): Promise<string> {
  try {
    const { captureScreen } = await import('react-native-view-shot');
    const uri = await captureScreen({
      format: args.format === 'jpeg' ? 'jpg' : 'png',
      quality: 0.9,
      result: 'base64',
    });
    return JSON.stringify({
      status: 'captured',
      format: args.format || 'png',
      base64Length: uri.length,
      data: uri.slice(0, 1000) + (uri.length > 1000 ? '...(truncated)' : ''),
    });
  } catch {
    // Fallback: return a message about needing react-native-view-shot
    return JSON.stringify({
      status: 'screenshot_not_available',
      message: 'Screen capture requires react-native-view-shot. Install it for this feature.',
    });
  }
}
