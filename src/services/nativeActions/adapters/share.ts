import { Share } from 'react-native';

import { normalizeOptionalMimeType, resolveLocalFile } from '../files';
import {
  errorToNativeActionResult,
  makeActionFailure,
  makeActionResult,
  NativeActionResult,
  ShareFileArgs,
  ShareTextArgs,
  ShareUrlArgs,
} from '../types';
import { normalizeRequiredString, normalizeUrlWithAllowlist } from '../validators';

const WEB_URL_SCHEMES = new Set(['http', 'https']);

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
    'shared',
    summary,
    { activityType: result.activityType || null },
    'share_completed',
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

export async function shareUrl(
  args: ShareUrlArgs,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const { url } = normalizeUrlWithAllowlist(args.url, WEB_URL_SCHEMES);
    const message = args.message ? normalizeRequiredString(args.message, 'message') : undefined;
    return shareWithNativeSheet(
      {
        ...(message ? { message } : {}),
        url,
      },
      'Opened the native share sheet for a URL.',
      args.title,
    );
  } catch (error) {
    return errorToNativeActionResult(error, 'share_url_failed', 'URL sharing failed');
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
      'shared',
      'Opened the native share sheet for a file.',
      {
        fileUri: resolvedFile.fileUri,
        contentUri: resolvedFile.contentUri || null,
        mimeType: mimeType || null,
      },
      'share_file_completed',
    );
  } catch (error) {
    return errorToNativeActionResult(error, 'share_file_failed', 'File sharing failed');
  }
}
