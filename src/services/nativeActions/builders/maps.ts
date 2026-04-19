import { Platform } from 'react-native';

import { MapsOpenArgs, NativeActionError } from '../types';
import { normalizeFiniteNumber, normalizeOptionalString } from '../validators';

interface NormalizedMapsArgs {
  query?: string;
  latitude?: number;
  longitude?: number;
  label?: string;
}

function normalizeMapsArgs(args: MapsOpenArgs): NormalizedMapsArgs {
  const query = normalizeOptionalString(args.query, 'query');
  const latitude = normalizeFiniteNumber(args.latitude, 'latitude');
  const longitude = normalizeFiniteNumber(args.longitude, 'longitude');
  const label = normalizeOptionalString(args.label, 'label');

  if (!query && (latitude === undefined || longitude === undefined)) {
    throw new NativeActionError(
      'invalid_maps_request',
      'maps_open requires either a query or both latitude and longitude.',
    );
  }

  if ((latitude === undefined) !== (longitude === undefined)) {
    throw new NativeActionError(
      'invalid_maps_request',
      'maps_open requires both latitude and longitude when coordinates are provided.',
    );
  }

  return { query, latitude, longitude, label };
}

export function buildMapsUrl(args: MapsOpenArgs): string {
  const normalized = normalizeMapsArgs(args);
  const hasCoordinates = normalized.latitude !== undefined && normalized.longitude !== undefined;

  if (Platform.OS === 'android') {
    if (hasCoordinates) {
      const coordinates = `${normalized.latitude},${normalized.longitude}`;
      if (normalized.label) {
        return `geo:${coordinates}?q=${coordinates}(${encodeURIComponent(normalized.label)})`;
      }
      if (normalized.query) {
        return `geo:${coordinates}?q=${encodeURIComponent(normalized.query)}`;
      }
      return `geo:${coordinates}`;
    }

    return `geo:0,0?q=${encodeURIComponent(normalized.query || '')}`;
  }

  if (hasCoordinates) {
    const query = normalized.label || normalized.query;
    if (query) {
      return `http://maps.apple.com/?ll=${normalized.latitude},${normalized.longitude}&q=${encodeURIComponent(query)}`;
    }
    return `http://maps.apple.com/?ll=${normalized.latitude},${normalized.longitude}`;
  }

  return `http://maps.apple.com/?q=${encodeURIComponent(normalized.query || '')}`;
}

export function summarizeMapsTarget(args: MapsOpenArgs): string {
  const normalized = normalizeMapsArgs(args);
  if (normalized.label) {
    return normalized.label;
  }
  if (normalized.query) {
    return normalized.query;
  }
  return `${normalized.latitude}, ${normalized.longitude}`;
}
