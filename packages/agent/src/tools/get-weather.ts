import { tool } from "ai";
import { z } from "zod";
import debug from "debug";

const debugGetWeather = debug("agent:get-weather");

export function makeGetWeatherTool() {
  return tool({
    description:
      "Get weather forecast for a specified location for up to 16 days. If location not found, try higher-level location name.",
    inputSchema: z.object({
      place: z
        .string()
        .min(1)
        .describe("Location name (e.g., 'Madrid', 'New York', 'Tokyo, Japan')"),
      days: z
        .number()
        .int()
        .min(1)
        .max(16)
        .optional()
        .default(1)
        .describe("Number of forecast days (1-16, default: 1)"),
    }),
    execute: async (context) => {
      const { place, days = 1 } = context;

      try {
        if (!place || typeof place !== "string") {
          throw new Error("place must be a non-empty string");
        }
        const nDays = Math.max(1, Math.min(Number(days) || 1, 16)); // Open-Meteo: up to 16 days

        // 1) Geocode the place to lat/lon (no key required)
        const geoUrl = new URL(
          "https://geocoding-api.open-meteo.com/v1/search"
        );
        geoUrl.searchParams.set("name", place);
        geoUrl.searchParams.set("count", "1");
        geoUrl.searchParams.set("language", "en");

        const geoRes = await fetch(geoUrl);
        if (!geoRes.ok)
          throw new Error(
            `Geocoding failed: ${geoRes.status} ${geoRes.statusText}`
          );
        const geo = await geoRes.json();

        if (!geo.results || geo.results.length === 0) {
          throw new Error(`No results for location: "${place}"`);
        }

        const { latitude, longitude, timezone, name, country, admin1 } =
          geo.results[0];

        // 2) Fetch the daily forecast
        const wxUrl = new URL("https://api.open-meteo.com/v1/forecast");
        wxUrl.searchParams.set("latitude", latitude);
        wxUrl.searchParams.set("longitude", longitude);
        wxUrl.searchParams.set("forecast_days", String(nDays));
        wxUrl.searchParams.set("timezone", "auto"); // use local time at location
        wxUrl.searchParams.set(
          "daily",
          [
            "weathercode",
            "temperature_2m_max",
            "temperature_2m_min",
            "precipitation_sum",
            "windspeed_10m_max",
          ].join(",")
        );

        const wxRes = await fetch(wxUrl);
        if (!wxRes.ok)
          throw new Error(
            `Forecast failed: ${wxRes.status} ${wxRes.statusText}`
          );
        const data = await wxRes.json();

        // Optional: tiny weathercode → text mapper
        const codeText = (code: number) =>
          ({
            0: "Clear",
            1: "Mainly clear",
            2: "Partly cloudy",
            3: "Overcast",
            45: "Fog",
            48: "Rime fog",
            51: "Light drizzle",
            53: "Drizzle",
            55: "Heavy drizzle",
            61: "Light rain",
            63: "Rain",
            65: "Heavy rain",
            66: "Freezing rain (light)",
            67: "Freezing rain (heavy)",
            71: "Light snow",
            73: "Snow",
            75: "Heavy snow",
            77: "Snow grains",
            80: "Rain showers (light)",
            81: "Rain showers",
            82: "Rain showers (heavy)",
            85: "Snow showers (light)",
            86: "Snow showers (heavy)",
            95: "Thunderstorm",
            96: "Thunderstorm w/ hail (light)",
            99: "Thunderstorm w/ hail (heavy)",
          }[code] ?? `Code ${code}`);

        // Shape a friendly array of days
        const daily = data.daily.time.map((date: string, i: number) => ({
          date, // local date at the location
          summary: codeText(data.daily.weathercode[i]),
          tempMaxC: data.daily.temperature_2m_max[i],
          tempMinC: data.daily.temperature_2m_min[i],
          precipMm: data.daily.precipitation_sum[i],
          windMaxKph: Math.round((data.daily.windspeed_10m_max[i] ?? 0) * 3.6),
        }));

        const result = {
          success: true,
          place: [name, admin1, country].filter(Boolean).join(", "),
          coordinates: { latitude, longitude },
          timezone: data.timezone ?? timezone,
          days: daily.length,
          daily,
        };

        debugGetWeather("Weather forecast result:", result);
        return result;
      } catch (error) {
        console.error("Error getting weather:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
        };
      }
    },
  });
}
