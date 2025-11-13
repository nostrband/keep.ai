import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { initSandbox, Sandbox } from "../../agent/src/sandbox/sandbox";

async function expectOk<T>(result: { ok: boolean; result?: T; error?: string }): Promise<T> {
  if (!result.ok) {
    throw new Error(`Sandbox evaluation failed unexpectedly: ${result.error ?? "unknown error"}`);
  }
  return result.result as T;
}

async function expectErr(result: { ok: boolean; result?: unknown; error?: string }): Promise<string> {
  if (result.ok) {
    throw new Error(`Sandbox evaluation succeeded unexpectedly: ${JSON.stringify(result.result)}`);
  }
  return result.error ?? "unknown error";
}

describe("Sandbox", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await initSandbox({ timeoutMs: 250 });
  });

  afterEach(() => {
    sandbox?.[Symbol.dispose]?.();
  });

  it("evaluates synchronous code and returns primitive results", async () => {
    const result = await sandbox.eval(`
      const value = 2 + 3;
      return value;
    `);

    const value = await expectOk(result);
    expect(value).toBe(5);
  });

  it("evaluates asynchronous guest code with awaited promises", async () => {
    const result = await sandbox.eval(`
      const first = await Promise.resolve(40);
      const second = await Promise.resolve(2);
      return first + second;
    `);

    const value = await expectOk(result);
    expect(value).toBe(42);
  });

  it("returns complex guest objects", async () => {
    const result = await sandbox.eval(`
      return {
        nested: { arr: [1, "two", { deep: true }] },
        flag: true,
        number: 123.456,
      };
    `);

    const value = await expectOk(result);
    expect(value).toStrictEqual({
      nested: { arr: [1, "two", { deep: true }] },
      flag: true,
      number: 123.456,
    });
  });

  it("exposes host globals with sync and async callbacks", async () => {
    sandbox.setGlobal({
      host: {
        data: "abc",
        toUpper(value: string) {
          return value.toUpperCase();
        },
        async doubleLater(n: number) {
          await Promise.resolve();
          return n * 2;
        },
        bytes: new Uint8Array([1, 2, 3]),
      },
    });

    const result = await sandbox.eval(`
      const sync = host.toUpper("guest");
      const asyncVal = await host.doubleLater(21);
      return {
        data: host.data,
        sync,
        async: asyncVal,
        bytes: host.bytes,
      };
    `);

    const value = await expectOk(result);
    expect(value).toStrictEqual({
      data: "abc",
      sync: "GUEST",
      async: 42,
      bytes: [1, 2, 3],
    });
  });

  it("propagates host callback errors back to the caller", async () => {
    sandbox.setGlobal({
      host: {
        explode() {
          throw new Error("host boom");
        },
      },
    });

    const result = await sandbox.eval(`
      host.explode();
    `);

    const error = await expectErr(result);
    expect(error).toContain("host boom");
  });

  it("captures guest-thrown errors", async () => {
    const result = await sandbox.eval(`
      throw new Error("guest boom");
    `);

    const error = await expectErr(result);
    expect(error).toContain("guest boom");
  });

  it("reports promise rejections", async () => {
    const result = await sandbox.eval(`
      await Promise.reject(new Error("rejected promise"));
    `);

    const error = await expectErr(result);
    expect(error).toContain("rejected promise");
  });

  it("aborts long-running execution via timeout", async () => {
    const result = await sandbox.eval(
      `
        while (true) {}
      `,
      { timeoutMs: 20 },
    );

    const error = await expectErr(result);
    expect(error.toLowerCase()).toContain("timed out");
  });

  it("supports abort signals to stop evaluation", async () => {
    const controller = new AbortController();
    const evaluation = sandbox.eval(
      `
        await new Promise(() => {});
        return "done";
      `,
      { timeoutMs: 1_000, signal: controller.signal },
    );

    setTimeout(() => controller.abort(), 10);

    const result = await evaluation;
    const error = await expectErr(result);
    expect(error).toBe("Aborted");
  });
});