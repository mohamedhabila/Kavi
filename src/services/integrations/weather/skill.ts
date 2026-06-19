import type { Skill } from '../../skills/types';
import { createApiTool } from '../shared/toolFactory';
import { fetchCurrentWeather, fetchForecast } from './openWeatherClient';

export function createWeatherSkill(): Skill {
  return {
    id: 'weather',
    name: 'Weather',
    description: 'Current weather and 5-day forecasts using geocoded location lookups or lat/lon coordinates',
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
      ),
    ],
  };
}
