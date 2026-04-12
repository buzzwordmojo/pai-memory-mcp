import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface PaiMemoryConfig {
  excludeProjects: string[];
  excludePatterns: string[];
  protectedProjects: string[];
}

const DEFAULT_CONFIG: PaiMemoryConfig = {
  excludeProjects: [],
  excludePatterns: [],
  protectedProjects: [],
};

export function loadConfig(): PaiMemoryConfig {
  // Check project-local config first, then ~/.pai-memory.json
  const candidates = [
    path.join(process.cwd(), ".pai-memory.json"),
    path.join(os.homedir(), ".pai-memory.json"),
  ];

  for (const filepath of candidates) {
    if (fs.existsSync(filepath)) {
      const raw = JSON.parse(fs.readFileSync(filepath, "utf-8"));
      return { ...DEFAULT_CONFIG, ...raw };
    }
  }

  return DEFAULT_CONFIG;
}

export function isProjectExcluded(
  project: string | undefined,
  config: PaiMemoryConfig
): boolean {
  if (!project) return false;
  return config.excludeProjects.includes(project);
}

export function redactContent(
  content: string,
  config: PaiMemoryConfig
): { content: string; redacted: boolean } {
  if (config.excludePatterns.length === 0) return { content, redacted: false };

  let result = content;
  let redacted = false;

  for (const pattern of config.excludePatterns) {
    const regex = new RegExp(pattern, "g");
    if (regex.test(result)) {
      redacted = true;
      result = result.replace(regex, "[REDACTED]");
    }
  }

  return { content: result, redacted };
}
