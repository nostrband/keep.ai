import { z } from "zod";
import debug from "debug";
import { EvalContext } from "../sandbox/sandbox";
import { LogicError, InternalError, classifyHttpError, isClassifiedError } from "../errors";
import { defineReadOnlyTool, Tool } from "./types";

const debugGetWeather = debug("agent:get-weather");

const inputSchema = z.union([
  z
    .string()
    .min(1)
    .describe("Location name string (shorthand for { place: string })"),
  z.object({
    place: z
      .string()
      .min(1)
      .describe(
        "Location name (e.g., 'Madrid', 'New York', 'Tokyo, Japan')"
      ),
    days: z
      .number()
      .int()
      .min(1)
      .max(16)
      .optional()
      .default(1)
      .describe("Number of forecast days (1-16, default: 1)"),
  }),
  z.object({
    location: z
      .string()
      .min(1)
      .describe("Location name (alternative to 'place')"),
    days: z
      .number()
      .int()
      .min(1)
      .max(16)
      .optional()
      .default(1)
      .describe("Number of forecast days (1-16, default: 1)"),
  }),
]);

const outputSchema = z.object({
  place: z.string().describe("Formatted location name"),
  coordinates: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
    })
    .describe("Geographic coordinates"),
  timezone: z.string().describe("Local timezone"),
  days: z.number().describe("Number of forecast days returned"),
  daily: z
    .array(
      z.object({
        date: z.string().describe("Local date at the location"),
        summary: z.string().describe("Weather condition summary"),
        tempMaxC: z.number().describe("Maximum temperature in Celsius"),
        tempMinC: z.number().describe("Minimum temperature in Celsius"),
        precipMm: z
          .number()
          .describe("Precipitation amount in millimeters"),
        windMaxKph: z.number().describe("Maximum wind speed in km/h"),
      })
    )
    .describe("Daily weather forecast array"),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

/**
 * Create the Weather.get tool.
 * This is a read-only tool - can be used outside Items.withItem().
 */
export function makeGetWeatherTool(getContext: () => EvalContext): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Weather",
    name: "get",
    description: `Get weather forecast for a specified location for up to 16 days. If location not found, try higher-level location name. If user didn't specify location, try to get user's location from Notes or message history (Memory.* APIs).

ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    outputSchema,
    execute: async (params) => {
      let place: string;
      let days: number = 1;

      if (typeof params === "string") {
        place = params;
      } else {
        const ctx = params || {};
        place = (ctx as any).place || (ctx as any).location;
        days = (ctx as any).days || 1;
      }

      if (!place || typeof place !== "string") {
        throw new LogicError("place must be a non-empty string", { source: "Weather" });
      }
      const nDays = Math.max(1, Math.min(Number(days) || 1, 16)); // Open-Meteo: up to 16 days

      // 1) Geocode the place to lat/lon (no key required)
      const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
      geoUrl.searchParams.set("name", place);
      geoUrl.searchParams.set("count", "1");
      geoUrl.searchParams.set("language", "en");

      let geo;
      try {
        const geoRes = await fetch(geoUrl);
        if (!geoRes.ok) {
          throw classifyHttpError(
            geoRes.status,
            `Geocoding failed: ${geoRes.status} ${geoRes.statusText}`,
            { source: "Weather" }
          );
        }
        geo = await geoRes.json();
      } catch (error) {
        if (isClassifiedError(error)) throw error;
        throw new InternalError(error instanceof Error ? error.message : String(error), { cause: error instanceof Error ? error : undefined, source: "Weather" });
      }

      if (!geo.results || geo.results.length === 0) {
        throw new LogicError(`No results for location: "${place}"`, { source: "Weather" });
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

      let data;
      try {
        const wxRes = await fetch(wxUrl);
        if (!wxRes.ok) {
          throw classifyHttpError(
            wxRes.status,
            `Forecast failed: ${wxRes.status} ${wxRes.statusText}`,
            { source: "Weather" }
          );
        }
        data = await wxRes.json();
      } catch (error) {
        if (isClassifiedError(error)) throw error;
        throw new InternalError(error instanceof Error ? error.message : String(error), { cause: error instanceof Error ? error : undefined, source: "Weather" });
      }

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
        place: [name, admin1, country].filter(Boolean).join(", "),
        coordinates: { latitude, longitude },
        timezone: data.timezone ?? timezone,
        days: daily.length,
        daily,
      };

      await getContext().createEvent("get_weather", { place, days });

      debugGetWeather("Weather forecast result:", result);
      return result;
    },
  }) as Tool<Input, Output>;
}
