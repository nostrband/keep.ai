export interface Env {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  AGENT_MODEL?: string;
  EXA_API_KEY?: string;
}

let env: Env = {};

export function setEnv(newEnv: Env) {
  env = {
    ...newEnv,
    ...env
  }
}

export function getEnv(): Env {
  return env;
}
