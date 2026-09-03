import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

const UNSAFE_CMD_CHARS = /[&|<>^()%!`"\r\n]/;
const SENSITIVE_ENV = /(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|AUTH|CREDENTIAL|DATABASE_URL|AWS_|AZURE_|GOOGLE_|GCP_|TWILIO_)/i;

export function sanitizedLspEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (SENSITIVE_ENV.test(key)) delete env[key];
  }
  delete env.NODE_OPTIONS;
  delete env.NODE_EXTRA_CA_CERTS;
  delete env.BASH_ENV;
  delete env.ENV;
  delete env.GIT_EXTERNAL_DIFF;
  delete env.GIT_DIFF_OPTS;
  return env;
}

function quoteCmdArg(value: string): string {
  if (UNSAFE_CMD_CHARS.test(value)) throw new Error("unsafe Windows command path or argument");
  return `"${value}"`;
}

/** Spawn a language server without Node's deprecated shell-argument joining. */
export function spawnSafeChild(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    const comspec = process.env.ComSpec ?? process.env.comspec ?? "cmd.exe";
    const quote = String.fromCharCode(34);
    const commandLine = `${quote}${quote}${command}${quote}${args.length > 0 ? ` ${args.map(quoteCmdArg).join(" ")}` : ""}${quote}`;
    return spawn(comspec, ["/d", "/s", "/c", commandLine], {
      ...options,
      shell: false,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(command, args, { ...options, shell: false });
}
