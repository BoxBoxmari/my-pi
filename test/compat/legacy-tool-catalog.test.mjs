import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { MyPiServer, createFoundationCapabilities } from "../../packages/mcp-adapter/dist/index.js";
import { WorkspaceRuntime } from "../../packages/workspace-runtime/dist/index.js";

const EXPECTED_TOOL_NAMES = [
  "ast_search",
  "fs_patch",
  "fs_read",
  "fs_stat",
  "fs_write",
  "lsp_diagnostics",
  "lsp_navigate",
  "lsp_status",
  "lsp_symbols",
  "search",
  "vcs_diff",
  "vcs_status",
  "workspace_info",
];

const EXPECTED_SCHEMAS = {
  "workspace_info": {
    "type": "object",
    "properties": {}
  },
  "fs_stat": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Workspace-relative file or directory path to stat (e.g. src or src/index.ts). Never reads file contents."
      }
    },
    "required": [
      "path"
    ]
  },
  "fs_read": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Workspace-relative file path to read (e.g. src/index.ts). Must stay inside the workspace root."
      },
      "offset": {
        "description": "Byte offset to start reading from. Default 0. Use next_offset from a prior truncated read to page forward.",
        "type": "integer",
        "minimum": 0,
        "maximum": 9007199254740991
      },
      "max_bytes": {
        "description": "Max bytes to return in this window (1..1048576). Default is a ~64KB window. Smaller windows page large files.",
        "type": "integer",
        "minimum": 1,
        "maximum": 1048576
      }
    },
    "required": [
      "path"
    ]
  },
  "fs_write": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Workspace-relative destination file path. Parent directories must already exist or be inside the workspace."
      },
      "content": {
        "type": "string",
        "maxLength": 8388608,
        "description": "Full UTF-8 replacement content for the file (max 8MB). This replaces the entire file."
      },
      "expected_hash": {
        "description": "sha256:... fingerprint from a prior fs_read. Required when overwriting an existing file; omit only for new files. Mismatches fail with stale-resource.",
        "type": "string"
      }
    },
    "required": [
      "path",
      "content"
    ]
  },
  "fs_patch": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Workspace-relative path of the existing file to patch. Must already exist and be a text file."
      },
      "patch": {
        "type": "object",
        "properties": {
          "hunks": {
            "maxItems": 1000,
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "old": {
                  "type": "string",
                  "maxLength": 1048576,
                  "description": "Exact verbatim text to match in the current file."
                },
                "new": {
                  "type": "string",
                  "maxLength": 1048576,
                  "description": "Replacement text for the matched old block."
                }
              },
              "required": [
                "old",
                "new"
              ]
            },
            "description": "Ordered list of old/new hunks applied verbatim (max 1000 hunks)."
          }
        },
        "required": [
          "hunks"
        ]
      },
      "expected_hash": {
        "description": "sha256:... fingerprint from a prior fs_read. Required; the patch fails with stale-resource when the file changed since the read.",
        "type": "string"
      }
    },
    "required": [
      "path",
      "patch"
    ]
  },
  "search": {
    "type": "object",
    "properties": {
      "mode": {
        "type": "string",
        "enum": [
          "grep",
          "glob"
        ],
        "description": "grep searches file contents; glob matches filenames (e.g. **/*.ts)."
      },
      "pattern": {
        "type": "string",
        "description": "Grep text/regex (mode=grep) or glob pattern (mode=glob, e.g. src/**/*.ts). Max ~2KB."
      },
      "path": {
        "description": "Optional workspace-relative directory to scope the search. Defaults to the workspace root. Files are rejected; use a directory.",
        "type": "string"
      }
    },
    "required": [
      "mode",
      "pattern"
    ]
  },
  "vcs_status": {
    "type": "object",
    "properties": {
      "path": {
        "description": "Optional workspace-relative directory to scope git status. Defaults to the workspace root. Must stay inside the workspace.",
        "type": "string"
      }
    }
  },
  "vcs_diff": {
    "type": "object",
    "properties": {
      "path": {
        "description": "Optional workspace-relative directory or file to scope the git diff. Defaults to the workspace root. Large diffs spill to an artifact reference.",
        "type": "string"
      }
    }
  },
  "ast_search": {
    "type": "object",
    "properties": {
      "pattern": {
        "type": "string",
        "maxLength": 8192,
        "description": "Tree-sitter query (e.g. (function_declaration name: (identifier) @name)) or node-type/text to match (e.g. function_declaration). Max 8KB."
      },
      "paths": {
        "maxItems": 2000,
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "Workspace-relative files or directories to search (max 2000). Omit to scan the workspace excluding dot/node_modules/target/dist."
      },
      "mode": {
        "description": "text matches node types/text; query runs a Tree-sitter query with @captures. Auto-detected when omitted.",
        "type": "string",
        "enum": [
          "text",
          "query"
        ]
      }
    },
    "required": [
      "pattern",
      "paths"
    ]
  },
  "lsp_status": {
    "type": "object",
    "properties": {}
  },
  "lsp_diagnostics": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Workspace-relative source file to get compiler/linter diagnostics for (e.g. src/index.ts)."
      }
    },
    "required": [
      "path"
    ]
  },
  "lsp_symbols": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Workspace-relative source file to outline (functions, classes, methods, variables)."
      }
    },
    "required": [
      "path"
    ]
  },
  "lsp_navigate": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": [
          "definition",
          "references",
          "hover"
        ],
        "description": "definition jumps to declaration, references lists usages, hover shows documentation."
      },
      "path": {
        "type": "string",
        "description": "Workspace-relative source file containing the symbol position."
      },
      "line": {
        "description": "0-based line number of the symbol. Default 0. Get exact lines from lsp_symbols.",
        "type": "integer",
        "minimum": 0,
        "maximum": 1000000
      },
      "column": {
        "description": "0-based column number of the symbol. Default 0.",
        "type": "integer",
        "minimum": 0,
        "maximum": 1000000
      }
    },
    "required": [
      "action",
      "path"
    ]
  }
};

function withoutSchemaMeta(schema) {
  const copy = structuredClone(schema);
  delete copy.$schema;
  return copy;
}

test("PN0 compatibility: the MCP catalog exposes exactly the 13 legacy tools and schemas", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "my-pi-compat-"));
  const runtime = new WorkspaceRuntime();
  const client = new Client({ name: "my-pi-compat-test", version: "1" });
  try {
    await runtime.open({ root: dir });
    const server = new MyPiServer({ runtime, capabilities: createFoundationCapabilities(runtime) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const response = await client.listTools();
    const actual = Object.fromEntries(response.tools.map((tool) => [tool.name, withoutSchemaMeta(tool.inputSchema)]));
    assert.deepEqual(response.tools.map((tool) => tool.name).sort(), EXPECTED_TOOL_NAMES);
    assert.deepEqual(actual, EXPECTED_SCHEMAS);
  } finally {
    await client.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
});
