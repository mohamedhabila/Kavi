import {
  installServiceIntegrationsReset,
  createWeatherSkill,
  mockFetch,
  mockGetSecure,
} from '../helpers/serviceIntegrationsHarness';

describe('Service Integrations', () => {
  installServiceIntegrationsReset();

  describe('createWeatherSkill', () => {
    it('should create weather skill with 2 tools', () => {
      const skill = createWeatherSkill();
      expect(skill.id).toBe('weather');
      expect(skill.name).toBe('Weather');
      expect(skill.tools).toHaveLength(2);
      expect(skill.tools[0].name).toBe('current');
      expect(skill.tools[1].name).toBe('forecast');
    });

    it('current tool should throw if no API key', async () => {
      mockGetSecure.mockResolvedValue(null);
      const skill = createWeatherSkill();
      await expect(skill.tools[0].handler!({ location: 'London' })).rejects.toThrow(
        'not configured',
      );
    });

    it('current tool should return weather data', async () => {
      mockGetSecure.mockResolvedValue('weather-key');
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ name: 'London', lat: 51.5072, lon: -0.1276, country: 'GB' }],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            name: 'London',
            sys: { country: 'GB' },
            main: { temp: 15, feels_like: 14, humidity: 70 },
            weather: [{ description: 'cloudy' }],
            wind: { speed: 5 },
          }),
        });

      const skill = createWeatherSkill();
      const result = await skill.tools[0].handler!({ location: 'London' });
      const data = JSON.parse(result);
      expect(data.location).toBe('London');
      expect(data.temp).toBe(15);
      expect(data.coordinates).toEqual({ lat: 51.5072, lon: -0.1276 });
      expect(mockFetch.mock.calls[0][0]).toContain('/geo/1.0/direct');
      expect(mockFetch.mock.calls[1][0]).toContain('/data/2.5/weather');
    });

    it('forecast tool should throw if no API key', async () => {
      mockGetSecure.mockResolvedValue(null);
      const skill = createWeatherSkill();
      await expect(skill.tools[1].handler!({ location: 'London' })).rejects.toThrow(
        'not configured',
      );
    });

    it('forecast tool should return forecast data', async () => {
      mockGetSecure.mockResolvedValue('weather-key');
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ name: 'London', lat: 51.5072, lon: -0.1276, country: 'GB' }],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            city: { name: 'London', country: 'GB' },
            list: Array.from({ length: 40 }, (_, i) => ({
              dt_txt: `2025-01-${String((i % 5) + 1).padStart(2, '0')} ${String((i % 8) * 3).padStart(2, '0')}:00:00`,
              main: { temp: 10 + i },
              weather: [{ description: 'sunny' }],
            })),
          }),
        });

      const skill = createWeatherSkill();
      const result = await skill.tools[1].handler!({ location: 'London' });
      const data = JSON.parse(result);
      expect(data.location).toBe('London');
      expect(data.forecasts.length).toBe(5);
      expect(mockFetch.mock.calls[0][0]).toContain('/geo/1.0/direct');
      expect(mockFetch.mock.calls[1][0]).toContain('/data/2.5/forecast');
    });

    it('current tool should support exact coordinates without geocoding', async () => {
      mockGetSecure.mockResolvedValue('weather-key');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'Cairo',
          sys: { country: 'EG' },
          main: { temp: 31, feels_like: 33, humidity: 40 },
          weather: [{ description: 'clear sky' }],
          wind: { speed: 3 },
        }),
      });

      const skill = createWeatherSkill();
      const result = await skill.tools[0].handler!({ lat: 30.0444, lon: 31.2357 });
      const data = JSON.parse(result);
      expect(data.location).toBe('Cairo');
      expect(data.coordinates).toEqual({ lat: 30.0444, lon: 31.2357 });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain('lat=30.0444');
    });
  });
});
