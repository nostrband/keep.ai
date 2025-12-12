export interface Env {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  AGENT_MODEL?: string;
  IMAGE_MODEL?: string;
  PDF_MODEL?: string;
  AUDIO_MODEL?: string;
  EXA_API_KEY?: string;
  LANG?: string;
  EXTRA_SYSTEM_PROMPT?: string;
  DESKTOP_NOTIFICATIONS?: string;
}

let env: Env = {};

export function setEnvFromProcess(processEnv: any) {
  env = {
    ...env,
    ...processEnv
  }
}

export function setEnv(newEnv: Env) {
  env = {
    ...env,
    ...newEnv,
  };
}

export function getEnv(): Env {
  return {
    ...env,
  };
}

export function isValidEnv() {
  return !!env.OPENROUTER_API_KEY?.trim();
}
