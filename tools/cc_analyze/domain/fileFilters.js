const path = require("path");

const VALID_EXTENSIONS = new Set([
  // Web & UI
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".html",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".vue",
  ".svelte",
  ".astro",
  // Systems & Apps
  ".py",
  ".pyw",
  ".java",
  ".kt",
  ".kts",
  ".cs",
  ".csx",
  ".c",
  ".cpp",
  ".cc",
  ".cxx",
  ".h",
  ".hpp",
  ".rs",
  ".go",
  ".rb",
  ".php",
  ".swift",
  ".dart",
  ".lua",
  ".pl",
  ".pm",
  ".r",
  ".R",
  // Data, Configurations & Scripts
  ".json",
  ".jsonc",
  ".json5",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".xaml",
  ".ini",
  ".conf",
  ".config",
  ".sh",
  ".bash",
  ".bat",
  ".cmd",
  ".ps1",
  ".sql",
  ".graphql",
  ".gql",
  ".prisma",
  ".gradle",
  // Documentation
  ".md",
  ".mdx",
  ".txt",
  ".rst",
]);

// Large auto-generated files or lockfiles that shouldn't be blamed/analyzed
const EXCLUDED_SUBSTRINGS = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "cargo.lock",
  "poetry.lock",
  "lint",
];

function isAnalyzableFile(filePath) {
  if (!filePath || typeof filePath !== "string") {
    return false;
  }

  // 1. Quick exit for heavy lockfiles/dependencies
  if (EXCLUDED_SUBSTRINGS.some((needle) => filePath.includes(needle))) {
    return false;
  }

  // 2. Extract extension and normalize it to lowercase
  const ext = path.extname(filePath).toLowerCase();

  // 3. O(1) Instant Hash Set Lookup (Much faster than looping over an array)
  return VALID_EXTENSIONS.has(ext);
}

module.exports = {
  VALID_EXTENSIONS,
  EXCLUDED_SUBSTRINGS,
  isAnalyzableFile,
};
