import { Share } from 'react-native';

import { normalizeOptionalMimeType, resolveLocalFile } from '../files';
import {
  errorToNativeActionResult,
  makeActionFailure,
  makeActionResult,
  NativeActionResult,
  ShareFileArgs,
  ShareTextArgs,
} from '../types';
import { normalizeRequiredString } from '../validators';

type SharingModule = typeof import('expo-sharing');

function loadSharingModule(): SharingModule | null {
  try {
    return require('expo-sharing') as SharingModule;
  } catch {
    return null;
  }
}

async function shareWithNativeSheet(
  payload: Record<string, string>,
  summary: string,
  title?: string,
): Promise<NativeActionResult<Record<string, unknown>>> {
  const result = await Share.share({
    ...payload,
    ...(title ? { title } : {}),
  } as any);

  if (result.action === Share.dismissedAction) {
    return makeActionResult(
      'cancelled',
      'Share sheet was dismissed.',
      { activityType: result.activityType || null },
      'share_cancelled',
    );
  }

  return makeActionResult(
    'handed_off',
    summary,
    { activityType: result.activityType || null },
    'share_handed_off',
  );
}

export async function shareText(
  args: ShareTextArgs,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const text = normalizeRequiredString(args.text, 'text');
    return shareWithNativeSheet(
      { message: text },
      'Opened the native share sheet for text.',
      args.title,
    );
  } catch (error) {
    return errorToNativeActionResult(error, 'share_text_failed', 'Text sharing failed');
  }
}

export async function shareFile(
  args: ShareFileArgs,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const resolvedFile = resolveLocalFile(args.fileUri, 'fileUri');
    const mimeType = normalizeOptionalMimeType(args.mimeType, 'mimeType') || resolvedFile.mimeType;
    const Sharing = loadSharingModule();
    if (!Sharing || !(await Sharing.isAvailableAsync())) {
      return makeActionFailure(
        'file_share_unavailable',
        'File sharing is unavailable on this device.',
        undefined,
        'unavailable',
      );
    }

    await Sharing.shareAsync(resolvedFile.fileUri, {
      dialogTitle: args.dialogTitle,
      mimeType,
      UTI: args.uti,
    });

    return makeActionResult(
      'handed_off',
      'Opened the native share sheet for a file.',
      {
        fileUri: resolvedFile.fileUri,
        contentUri: resolvedFile.contentUri || null,
        mimeType: mimeType || null,
      },
      'share_file_handed_off',
    );
  } catch (error) {
    return errorToNativeActionResult(error, 'share_file_failed', 'File sharing failed');
  }
}
