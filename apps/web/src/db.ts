import { createDBBrowser } from "@app/browser";
// @ts-ignore
import wasmUrl from '@vlcn.io/crsqlite-wasm/crsqlite.wasm?url';

export function createDB(file: string) {
  return createDBBrowser(file, wasmUrl);
}