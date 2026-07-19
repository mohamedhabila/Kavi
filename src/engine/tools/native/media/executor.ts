import * as ImagePicker from 'expo-image-picker';

import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../../../types/toolRuntimeOutcome';

export async function executePhotosPick(args: { count?: number }): Promise<ToolRuntimeOutcome> {
  try {
    const requestedCount =
      typeof args.count === 'number' && Number.isFinite(args.count) ? Math.floor(args.count) : 1;
    const count = Math.min(Math.max(requestedCount, 1), 20);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: count > 1,
      selectionLimit: count,
      quality: 1,
    });

    if (result.canceled || !result.assets?.length) {
      return failedToolOutcome(JSON.stringify({ status: 'cancelled' }));
    }

    return completedToolOutcome(
      JSON.stringify(
        {
          status: 'selected',
          assets: result.assets.slice(0, count).map((asset) => ({
            assetId: asset.assetId || null,
            uri: asset.uri,
            fileName: asset.fileName || null,
            fileSize: asset.fileSize || null,
            width: asset.width,
            height: asset.height,
            mimeType: asset.mimeType || null,
          })),
        },
      ),
    );
  } catch (err: unknown) {
    return failedToolOutcome(
      JSON.stringify({
        error: `Photo picker failed: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
  }
}

// ── Camera Clip Tool ─────────────────────────────────────────────────────

export async function executeCameraClip(args: {
  durationSeconds?: number;
  quality?: string;
  camera?: string;
}): Promise<ToolRuntimeOutcome> {
  try {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: args.durationSeconds || 10,
      quality: args.quality === 'high' ? 1 : args.quality === 'low' ? 0.3 : 0.5,
      cameraType:
        args.camera === 'front' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
    });

    if (result.canceled || !result.assets?.[0]) {
      return failedToolOutcome(JSON.stringify({ status: 'cancelled' }));
    }

    const asset = result.assets[0];
    return completedToolOutcome(
      JSON.stringify({
        status: 'recorded',
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        duration: asset.duration,
        mimeType: asset.mimeType || 'video/mp4',
      }),
    );
  } catch (err: unknown) {
    return failedToolOutcome(
      JSON.stringify({
        error: `Camera clip failed: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
  }
}

// ── Screen Record (Screenshot) Tool ──────────────────────────────────────

export async function executeScreenRecord(args: { format?: string }): Promise<ToolRuntimeOutcome> {
  try {
    const { captureScreen } = await import('react-native-view-shot');
    const uri = await captureScreen({
      format: args.format === 'jpeg' ? 'jpg' : 'png',
      quality: 0.9,
      result: 'base64',
    });
    return completedToolOutcome(
      JSON.stringify({
        status: 'captured',
        format: args.format || 'png',
        base64Length: uri.length,
        data: uri.slice(0, 1000) + (uri.length > 1000 ? '...(truncated)' : ''),
      }),
    );
  } catch {
    return failedToolOutcome(
      JSON.stringify({
        status: 'screenshot_not_available',
        message: 'Screen capture requires react-native-view-shot. Install it for this feature.',
      }),
    );
  }
}
