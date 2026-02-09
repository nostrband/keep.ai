import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeGetWeatherTool, type EvalContext } from "@app/agent";

function createMockContext(): EvalContext {
  return {
    taskThreadId: "test-thread",
    step: 0,
    type: "workflow",
    taskId: "test-task",
    cost: 0,
    createEvent: vi.fn().mockResolvedValue(undefined),
    onLog: vi.fn().mockResolvedValue(undefined),
  };
}

function mockGeoResponse(results: any[] | undefined = undefined) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      results: results ?? [
        {
          latitude: 40.4168,
          longitude: -3.7038,
          timezone: "Europe/Madrid",
          name: "Madrid",
          country: "Spain",
          admin1: "Community of Madrid",
        },
      ],
    }),
  };
}

function mockForecastResponse(days: number = 1) {
  const time = Array.from({ length: days }, (_, i) => `2026-02-${String(9 + i).padStart(2, "0")}`);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      timezone: "Europe/Madrid",
      daily: {
        time,
        weathercode: Array(days).fill(0),
        temperature_2m_max: Array(days).fill(15),
        temperature_2m_min: Array(days).fill(5),
        precipitation_sum: Array(days).fill(0),
        windspeed_10m_max: Array(days).fill(10),
      },
    }),
  };
}

describe("Weather Tool", () => {
  let mockContext: EvalContext;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    mockContext = createMockContext();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should get weather for a string location", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? mockGeoResponse() : mockForecastResponse();
    });

    const tool = makeGetWeatherTool(() => mockContext);
    const result = await tool.execute("Madrid");

    expect(result.place).toBe("Madrid, Community of Madrid, Spain");
    expect(result.coordinates).toEqual({ latitude: 40.4168, longitude: -3.7038 });
    expect(result.days).toBe(1);
    expect(result.daily).toHaveLength(1);
    expect(result.daily[0].summary).toBe("Clear");
    expect(result.daily[0].tempMaxC).toBe(15);
    expect(result.daily[0].tempMinC).toBe(5);
    expect(mockContext.createEvent).toHaveBeenCalledWith("get_weather", { place: "Madrid", days: 1 });
  });

  it("should get weather for object with place field", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? mockGeoResponse() : mockForecastResponse(3);
    });

    const tool = makeGetWeatherTool(() => mockContext);
    const result = await tool.execute({ place: "Madrid", days: 3 });

    expect(result.days).toBe(3);
    expect(result.daily).toHaveLength(3);
  });

  it("should get weather for object with location field", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? mockGeoResponse() : mockForecastResponse();
    });

    const tool = makeGetWeatherTool(() => mockContext);
    const result = await tool.execute({ location: "Madrid", days: 1 });

    expect(result.place).toContain("Madrid");
  });

  it("should throw LogicError for unknown location", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockGeoResponse([]));

    const tool = makeGetWeatherTool(() => mockContext);

    await expect(tool.execute("Nonexistentcity12345")).rejects.toThrow(
      'No results for location: "Nonexistentcity12345"'
    );
  });

  it("should throw LogicError when place is missing", async () => {
    const tool = makeGetWeatherTool(() => mockContext);

    await expect(tool.execute({ place: "" } as any)).rejects.toThrow();
  });

  it("should clamp days to valid range (1-16)", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? mockGeoResponse() : mockForecastResponse(16);
    });

    const tool = makeGetWeatherTool(() => mockContext);
    await tool.execute({ place: "Madrid", days: 16 });

    // Check forecast URL includes forecast_days=16
    const forecastCall = (globalThis.fetch as any).mock.calls[1];
    expect(forecastCall[0].toString()).toContain("forecast_days=16");
  });

  it("should map weather codes correctly", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return mockGeoResponse();
      return {
        ok: true,
        json: async () => ({
          timezone: "Europe/Madrid",
          daily: {
            time: ["2026-02-09"],
            weathercode: [95],
            temperature_2m_max: [20],
            temperature_2m_min: [10],
            precipitation_sum: [5],
            windspeed_10m_max: [15],
          },
        }),
      };
    });

    const tool = makeGetWeatherTool(() => mockContext);
    const result = await tool.execute("Madrid");

    expect(result.daily[0].summary).toBe("Thunderstorm");
  });

  it("should handle unknown weather codes", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return mockGeoResponse();
      return {
        ok: true,
        json: async () => ({
          timezone: "Europe/Madrid",
          daily: {
            time: ["2026-02-09"],
            weathercode: [999],
            temperature_2m_max: [20],
            temperature_2m_min: [10],
            precipitation_sum: [0],
            windspeed_10m_max: [5],
          },
        }),
      };
    });

    const tool = makeGetWeatherTool(() => mockContext);
    const result = await tool.execute("Madrid");

    expect(result.daily[0].summary).toBe("Code 999");
  });

  it("should handle geocoding API errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const tool = makeGetWeatherTool(() => mockContext);

    await expect(tool.execute("Madrid")).rejects.toThrow();
  });

  it("should handle forecast API errors", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return mockGeoResponse();
      return {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      };
    });

    const tool = makeGetWeatherTool(() => mockContext);

    await expect(tool.execute("Madrid")).rejects.toThrow();
  });

  it("should be a read-only tool", () => {
    const tool = makeGetWeatherTool(() => mockContext);
    expect(tool.isReadOnly?.({} as any)).toBe(true);
  });

  it("should handle network errors gracefully", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

    const tool = makeGetWeatherTool(() => mockContext);

    await expect(tool.execute("Madrid")).rejects.toThrow("Network failure");
  });
});
