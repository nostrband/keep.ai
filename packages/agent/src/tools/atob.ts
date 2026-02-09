import { JSONSchema } from "../json-schema";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema: JSONSchema = {
  type: "string",
  description: "Base64 or base64url encoded string",
};

const outputSchema: JSONSchema = {
  type: "string",
  description: "Decoded binary string",
};

type Input = string;
type Output = string;

/**
 * Create the Util.atob tool.
 * This is a read-only tool - can be used outside Items.withItem().
 */
export function makeAtobTool(): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Util",
    name: "atob",
    description: `Decode base64 or base64url encoded string to binary string, similar to Window.atob() (but with base64url support).

\u2139\ufe0f Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    outputSchema,
    execute: async (input: string) => {
      return atobCompatAny(input);
    },
  }) as Tool<Input, Output>;
}

export function atobCompatAny(input: string): string {
  const str = String(input);

  // Remove ASCII whitespace
  let s = str.replace(/[\t\n\f\r ]+/g, "");
  if (s.length === 0) return "";

  // Convert base64url -> base64 (only where needed)
  // (If already standard base64, this is a no-op.)
  s = s.replace(/-/g, "+").replace(/_/g, "/");

  // Add missing padding (base64url commonly omits it)
  // Valid lengths mod 4 are 0, 2, 3. mod 4 == 1 is invalid.
  const mod = s.length % 4;
  if (mod === 1) throw invalidCharErr();
  if (mod === 2) s += "==";
  else if (mod === 3) s += "=";

  // Validate '=' placement: only at the end, max two
  const firstPad = s.indexOf("=");
  if (firstPad !== -1) {
    for (let i = firstPad; i < s.length; i++) {
      if (s[i] !== "=") throw invalidCharErr();
    }
    const padLen = s.length - firstPad;
    if (padLen > 2) throw invalidCharErr();
  }

  // Decode
  const rev = getB64RevTable();
  return decodeBase64ToBinaryString(s, rev);
}

function decodeBase64ToBinaryString(s: string, rev: Uint8Array): string {
  let out = "";

  for (let i = 0; i < s.length; i += 4) {
    const c1 = s.charCodeAt(i);
    const c2 = s.charCodeAt(i + 1);
    const c3 = s.charCodeAt(i + 2);
    const c4 = s.charCodeAt(i + 3);

    const e1 = rev[c1];
    const e2 = rev[c2];
    if (e1 === 255 || e2 === 255) throw invalidCharErr();

    const ch3 = s[i + 2];
    const ch4 = s[i + 3];

    if (ch3 === "=") {
      // Must be "xx=="
      if (ch4 !== "=") throw invalidCharErr();
      const b1 = (e1 << 2) | (e2 >> 4);
      out += String.fromCharCode(b1 & 0xff);
      continue;
    }

    const e3 = rev[c3];
    if (e3 === 255) throw invalidCharErr();

    if (ch4 === "=") {
      // "xxx="
      const b1 = (e1 << 2) | (e2 >> 4);
      const b2 = ((e2 & 15) << 4) | (e3 >> 2);
      out += String.fromCharCode(b1 & 0xff, b2 & 0xff);
      continue;
    }

    const e4 = rev[c4];
    if (e4 === 255) throw invalidCharErr();

    const b1 = (e1 << 2) | (e2 >> 4);
    const b2 = ((e2 & 15) << 4) | (e3 >> 2);
    const b3 = ((e3 & 3) << 6) | e4;

    out += String.fromCharCode(b1 & 0xff, b2 & 0xff, b3 & 0xff);
  }

  return out;
}

let _revTable: Uint8Array | null = null;
function getB64RevTable(): Uint8Array {
  if (_revTable) return _revTable;

  // Only ASCII 0..127 are relevant; anything else will be invalid.
  const rev = new Uint8Array(128);
  rev.fill(255);

  for (let i = 0; i < 26; i++) rev[65 + i] = i;        // A-Z
  for (let i = 0; i < 26; i++) rev[97 + i] = 26 + i;   // a-z
  for (let i = 0; i < 10; i++) rev[48 + i] = 52 + i;   // 0-9
  rev[43] = 62; // +
  rev[47] = 63; // /

  _revTable = rev;
  return rev;
}

function invalidCharErr(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(
      "The string to be decoded is not correctly encoded.",
      "InvalidCharacterError"
    );
  }
  const e = new Error("The string to be decoded is not correctly encoded.");
  e.name = "InvalidCharacterError";
  return e;
}
