import { fetchJson } from '../shared/http';
import { requireSecret } from '../shared/secrets';

type WeatherUnits = 'standard' | 'metric' | 'imperial';

type OpenWeatherGeoEntry = {
  name?: string;
  lat?: number;
  lon?: number;
  country?: string;
  state?: string;
};

function normalizeWeatherUnits(value: unknown): WeatherUnits {
  const normalized = String(value || 'metric').trim().toLowerCase();
  if (normalized === 'standard' || normalized === 'metric' || normalized === 'imperial') {
    return normalized;
  }
  throw new Error('Weather units must be one of standard, metric, or imperial');
}

function readCoordinate(value: unknown, label: string): number | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Weather ${label} must be a valid number`);
  }
  return parsed;
}

function selectDailyForecastEntry(entries: any[]): any {
  const sorted = [...entries].sort((left, right) => {
    const leftHour = Number(String(left?.dt_txt || '').slice(11, 13) || 0);
    const rightHour = Number(String(right?.dt_txt || '').slice(11, 13) || 0);
    return Math.abs(leftHour - 12) - Math.abs(rightHour - 12);
  });
  return sorted[0] || entries[0];
}

async function resolveCoordinates(params: {
  location?: unknown;
  lat?: unknown;
  lon?: unknown;
}): Promise<{ lat: number; lon: number; location: string; country?: string; state?: string }> {
  const lat = readCoordinate(params.lat, 'lat');
  const lon = readCoordinate(params.lon, 'lon');
  if (lat != null || lon != null) {
    if (lat == null || lon == null) {
      throw new Error('Weather lookups require both lat and lon when coordinates are used');
    }
    return {
      lat,
      lon,
      location: typeof params.location === 'string' && params.location.trim() ? params.location : `${lat}, ${lon}`,
    };
  }

  const location = String(params.location || '').trim();
  if (!location) {
    throw new Error('Weather lookups require either location or both lat and lon');
  }

  const apiKey = await requireSecret('OPENWEATHER_API_KEY');
  const query = new URLSearchParams({
    q: location,
    limit: '1',
    appid: apiKey,
  });
  const matches = await fetchJson<OpenWeatherGeoEntry[]>({
    url: `https://api.openweathermap.org/geo/1.0/direct?${query.toString()}`,
    errorPrefix: 'Weather geocoding',
  });
  const match = matches[0];
  if (!match || match.lat == null || match.lon == null) {
    throw new Error(`Weather location "${location}" could not be resolved`);
  }

  return {
    lat: match.lat,
    lon: match.lon,
    location: match.name || location,
    country: match.country,
    state: match.state,
  };
}

export async function fetchCurrentWeather(args: Record<string, unknown>): Promise<string> {
  const apiKey = await requireSecret('OPENWEATHER_API_KEY');
  const units = normalizeWeatherUnits(args.units);
  const place = await resolveCoordinates(args);
  const query = new URLSearchParams({
    lat: String(place.lat),
    lon: String(place.lon),
    units,
    appid: apiKey,
  });
  const data = await fetchJson<any>({
    url: `https://api.openweathermap.org/data/2.5/weather?${query.toString()}`,
    errorPrefix: 'Weather API',
  });

  return JSON.stringify({
    location: data.name || place.location,
    country: place.country || data.sys?.country || null,
    state: place.state || null,
    coordinates: { lat: place.lat, lon: place.lon },
    units,
    temp: data.main?.temp,
    feels_like: data.main?.feels_like,
    temp_min: data.main?.temp_min,
    temp_max: data.main?.temp_max,
    humidity: data.main?.humidity,
    pressure: data.main?.pressure,
    description: data.weather?.[0]?.description,
    wind: data.wind,
  });
}

export async function fetchForecast(args: Record<string, unknown>): Promise<string> {
  const apiKey = await requireSecret('OPENWEATHER_API_KEY');
  const units = normalizeWeatherUnits(args.units);
  const place = await resolveCoordinates(args);
  const query = new URLSearchParams({
    lat: String(place.lat),
    lon: String(place.lon),
    units,
    appid: apiKey,
  });
  const data = await fetchJson<any>({
    url: `https://api.openweathermap.org/data/2.5/forecast?${query.toString()}`,
    errorPrefix: 'Weather forecast API',
  });

  const groupedByDate = new Map<string, any[]>();
  for (const entry of data.list || []) {
    const date = String(entry?.dt_txt || '').slice(0, 10);
    if (!date) {
      continue;
    }
    const existing = groupedByDate.get(date) || [];
    existing.push(entry);
    groupedByDate.set(date, existing);
  }

  const forecasts = Array.from(groupedByDate.entries())
    .slice(0, 5)
    .map(([date, entries]) => {
      const representative = selectDailyForecastEntry(entries);
      const temps = entries.map((entry) => Number(entry?.main?.temp)).filter(Number.isFinite);
      return {
        date,
        temp: representative?.main?.temp,
        minTemp: temps.length ? Math.min(...temps) : representative?.main?.temp_min,
        maxTemp: temps.length ? Math.max(...temps) : representative?.main?.temp_max,
        description: representative?.weather?.[0]?.description,
      };
    });

  return JSON.stringify({
    location: data.city?.name || place.location,
    country: place.country || data.city?.country || null,
    state: place.state || null,
    coordinates: { lat: place.lat, lon: place.lon },
    units,
    forecasts,
  });
}
