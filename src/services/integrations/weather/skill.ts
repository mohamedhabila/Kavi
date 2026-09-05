import type { Skill } from '../../skills/types';
import { secretRuntimeRequirement } from '../../../types/tool';
import { createApiTool } from '../shared/toolFactory';
import { fetchCurrentWeather, fetchForecast } from './openWeatherClient';

// Both tools call OpenWeather directly and fail without an API key, so each declares
// the same secret gate — otherwise the tool is advertised, the model calls it, and the
// call can only fail with "OPENWEATHER_API_KEY not configured".
const WEATHER_CONTRACT = {
  runtimeRequirements: [secretRuntimeRequirement('OPENWEATHER_API_KEY')],
};

export function createWeatherSkill(): Skill {
  return {
    id: 'weather',
    name: 'Weather',
    description:
      'Current weather and 5-day forecasts using geocoded location lookups or lat/lon coordinates',
    version: '2.0.0',
    tools: [
      createApiTool(
        'current',
        'Get current weather for a free-text location or exact lat/lon coordinates.',
        {
          location: {
            type: 'string',
            description: 'Free-text place query resolved through OpenWeather geocoding.',
          },
          lat: { type: 'number', description: 'Latitude for an exact coordinate lookup.' },
          lon: { type: 'number', description: 'Longitude for an exact coordinate lookup.' },
          units: {
            type: 'string',
            enum: ['standard', 'metric', 'imperial'],
            description: 'Temperature and wind units. Defaults to metric.',
          },
        },
        [],
        fetchCurrentWeather,
        { contract: WEATHER_CONTRACT },
      ),
      createApiTool(
        'forecast',
        'Get a 5-day forecast for a free-text location or exact lat/lon coordinates.',
        {
          location: {
            type: 'string',
            description: 'Free-text place query resolved through OpenWeather geocoding.',
          },
          lat: { type: 'number', description: 'Latitude for an exact coordinate lookup.' },
          lon: { type: 'number', description: 'Longitude for an exact coordinate lookup.' },
          units: {
            type: 'string',
            enum: ['standard', 'metric', 'imperial'],
            description: 'Temperature and wind units. Defaults to metric.',
          },
        },
        [],
        fetchForecast,
        { contract: WEATHER_CONTRACT },
      ),
    ],
  };
}
