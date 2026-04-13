import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface PaiMemoryConfig {
  includeProjects: string[];
  excludeProjects: string[];
  excludePatterns: string[];
  protectedProjects: string[];
  orgPrefixes: string[];
  projectNameOverrides: Record<string, string>;
}

const DEFAULT_CONFIG: PaiMemoryConfig = {
  includeProjects: [],
  excludeProjects: [],
  excludePatterns: [],
  protectedProjects: [],
  orgPrefixes: [],
  projectNameOverrides: {},
};

export function loadConfig(): PaiMemoryConfig {
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

export function extractProjectName(
  projectPath: string,
  config: PaiMemoryConfig
): string {
  // Strip worktree suffixes
  let cleaned = projectPath.replace(/--claude-worktrees-agent-[a-f0-9]+$/, "");

  // Remove home/user/projects prefix
  const projectsIdx = cleaned.indexOf("-projects-");
  if (projectsIdx !== -1) {
    cleaned = cleaned.slice(projectsIdx + "-projects-".length);
  } else {
    return projectPath;
  }

  // If what's left is just an org name, return it as-is
  if (config.orgPrefixes.includes(cleaned)) return cleaned;

  // Strip org prefix to get the project name
  for (const org of config.orgPrefixes) {
    if (cleaned.startsWith(org + "-")) {
      cleaned = cleaned.slice(org.length + 1);
      break;
    }
  }

  // Apply overrides
  return config.projectNameOverrides[cleaned] ?? cleaned ?? projectPath;
}

export function isProjectExcluded(
  project: string | undefined,
  config: PaiMemoryConfig
): boolean {
  if (!project) {
    // No project — excluded if includeProjects is set (only named projects allowed)
    return config.includeProjects.length > 0;
  }
  // If includeProjects is set, only those are allowed
  if (config.includeProjects.length > 0) {
    return !config.includeProjects.includes(project);
  }
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
