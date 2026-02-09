import { JSONSchema } from "../json-schema";
import debug from "debug";
import { EvalContext } from "../sandbox/sandbox";
import { LogicError, InternalError, classifyHttpError, isClassifiedError } from "../errors";
import { defineReadOnlyTool, Tool } from "./types";

const debugGetWeather = debug("agent:get-weather");

const inputSchema: JSONSchema = {
  anyOf: [
    {
      type: "string",
      minLength: 1,
      description: "Location name string (shorthand for { place: string })",
    },
    {
      type: "object",
      properties: {
        place: {
          type: "string",
          minLength: 1,
          description:
            "Location name (e.g., 'Madrid', 'New York', 'Tokyo, Japan')",
        },
        days: {
          type: "integer",
          minimum: 1,
          maximum: 16,
          default: 1,
          description: "Number of forecast days (1-16, default: 1)",
        },
      },
      required: ["place"],
    },
    {
      type: "object",
      properties: {
        location: {
          type: "string",
          minLength: 1,
          description: "Location name (alternative to 'place')",
        },
        days: {
          type: "integer",
          minimum: 1,
          maximum: 16,
          default: 1,
          description: "Number of forecast days (1-16, default: 1)",
        },
      },
      required: ["location"],
    },
  ],
};

const outputSchema: JSONSchema = {
  type: "object",
  properties: {
    place: { type: "string", description: "Formatted location name" },
    coordinates: {
      type: "object",
      properties: {
        latitude: { type: "number" },
        longitude: { type: "number" },
      },
      required: ["latitude", "longitude"],
      description: "Geographic coordinates",
    },
    timezone: { type: "string", description: "Local timezone" },
    days: { type: "number", description: "Number of forecast days returned" },
    daily: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "Local date at the location" },
          summary: { type: "string", description: "Weather condition summary" },
          tempMaxC: {
            type: "number",
            description: "Maximum temperature in Celsius",
          },
          tempMinC: {
            type: "number",
            description: "Minimum temperature in Celsius",
          },
          precipMm: {
            type: "number",
            description: "Precipitation amount in millimeters",
          },
          windMaxKph: {
            type: "number",
            description: "Maximum wind speed in km/h",
          },
        },
        required: [
          "date",
          "summary",
          "tempMaxC",
          "tempMinC",
          "precipMm",
          "windMaxKph",
        ],
      },
      description: "Daily weather forecast array",
    },
  },
  required: ["place", "coordinates", "timezone", "days", "daily"],
};

interface InputPlaceObject {
  place: string;
  days?: number;
}

interface InputLocationObject {
  location: string;
  days?: number;
}

type Input = string | InputPlaceObject | InputLocationObject;

interface DailyForecast {
  date: string;
  summary: string;
  tempMaxC: number;
  tempMinC: number;
  precipMm: number;
  windMaxKph: number;
}

interface Output {
  place: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  timezone: string;
  days: number;
  daily: DailyForecast[];
}

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
