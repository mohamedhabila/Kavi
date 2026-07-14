async function loadLocationModule() {
  try {
    return await import('expo-location');
  } catch {
    return null;
  }
}

export async function executeLocationCurrent(): Promise<ToolRuntimeOutcome> {
  const Location = await loadLocationModule();
  if (!Location) {
    return failedToolOutcome(JSON.stringify({ error: 'Location module not available' }));
  }

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    return failedToolOutcome(JSON.stringify({ error: 'Location permission denied' }));
  }

  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

  // Try reverse geocode
  let address: any = null;
  try {
    const [geo] = await Location.reverseGeocodeAsync({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    });
    if (geo) {
      address = {
        street: geo.street,
        city: geo.city,
        region: geo.region,
        postalCode: geo.postalCode,
        country: geo.country,
      };
    }
  } catch {
    // Reverse geocode not critical
  }

  return completedToolOutcome(
    JSON.stringify({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      altitude: location.coords.altitude,
      accuracy: location.coords.accuracy,
      timestamp: location.timestamp,
      address,
    }),
  );
}
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../../../types/toolRuntimeOutcome';
