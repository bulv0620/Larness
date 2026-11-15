// Allowlisted fields from https://opencode.ai/inference/go/v1/models (2026-11-15).
// A snapshot only fills fields for IDs already discovered on the Go connection.
export const GO_OFFICIAL_SNAPSHOT: Readonly<Record<string, unknown>> = {
  "deepseek-v4.1-flash": {
    limit: {
      context: 1000000,
      output: 384000,
    },
    modalities: {
      input: ["text", "image/jpeg", "image/png", "image/gif", "image/webp"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["low", "high", "max"],
      },
    },
  },
  "deepseek-v4-pro": {
    limit: {
      context: 1000000,
      output: 384000,
    },
    modalities: {
      input: ["text"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["high", "max"],
      },
    },
  },
  "glm-5.2": {
    limit: {
      context: 1000000,
      output: 131072,
    },
    modalities: {
      input: ["text"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["high", "max"],
      },
    },
  },
  "glm-5.3": {
    limit: {
      context: 1000000,
      output: 131072,
    },
    modalities: {
      input: ["text"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["low", "high", "max"],
      },
    },
  },
  "grok-4.7": {
    limit: {
      context: 500000,
      output: 500000,
    },
    modalities: {
      input: ["text", "image/jpeg", "image/png", "application/pdf"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["low", "medium", "high", "xhigh"],
      },
    },
  },
  "muse-spark-1.2-contributor": {
    limit: {
      context: 1048576,
      output: 131072,
    },
    modalities: {
      input: [
        "text",
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "video/mp4",
        "application/pdf",
        "audio/mpeg",
        "audio/wav",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["minimal", "low", "medium", "high", "xhigh"],
      },
    },
  },
  "muse-spark-1.3-contributor": {
    limit: {
      context: 1048576,
      output: 131072,
    },
    modalities: {
      input: [
        "text",
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "video/mp4",
        "application/pdf",
        "audio/mpeg",
        "audio/wav",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["minimal", "low", "medium", "high", "xhigh"],
      },
    },
  },
  "glm-5.3-flash": {
    limit: {
      context: 1000000,
      output: 131072,
    },
    modalities: {
      input: [
        "text",
        "image/jpeg",
        "image/png",
        "video/mp4",
        "video/x-matroska",
        "video/quicktime",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["low", "high", "max"],
      },
    },
  },
  "gpt-5.6-luna": {
    limit: {
      context: 1050000,
      input: 922000,
      output: 128000,
    },
    modalities: {
      input: ["text", "image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["none", "low", "medium", "high", "xhigh", "max"],
      },
    },
  },
  "gpt-6-luna": {
    limit: {
      context: 1050000,
      input: 922000,
      output: 128000,
    },
    modalities: {
      input: ["text", "image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["none", "low", "medium", "high", "xhigh", "max"],
      },
    },
  },
  "claude-haiku-5-5": {
    limit: {
      context: 1000000,
      output: 128000,
    },
    modalities: {
      input: ["text", "image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        toggle: true,
        effort: ["low", "medium", "high", "xhigh", "max"],
      },
    },
  },
  hy3: {
    limit: {
      context: 256000,
      input: 192000,
      output: 128000,
    },
    modalities: {
      input: ["text"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["none", "low", "high"],
      },
    },
  },
  "hy4-preview": {
    limit: {
      context: 1024000,
      output: 64000,
    },
    modalities: {
      input: ["text"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["none", "high"],
      },
    },
  },
  "kimi-k2.7-code": {
    limit: {
      context: 262144,
      output: 262144,
    },
    modalities: {
      input: [
        "text",
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/bmp",
        "image/heic",
        "image/heif",
        "video/mp4",
        "video/mpeg",
        "video/mov",
        "video/avi",
        "video/x-flv",
        "video/mpg",
        "video/webm",
        "video/wmv",
        "video/3gpp",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
      },
    },
  },
  "kimi-k3": {
    limit: {
      context: 1048576,
      output: 1048576,
    },
    modalities: {
      input: [
        "text",
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/bmp",
        "image/heic",
        "image/heif",
        "video/mp4",
        "video/mpeg",
        "video/mov",
        "video/avi",
        "video/x-flv",
        "video/mpg",
        "video/webm",
        "video/wmv",
        "video/3gpp",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["max"],
      },
    },
  },
  "mimo-v2.6-flash": {
    limit: {
      context: 1048576,
      output: 131072,
    },
    modalities: {
      input: [
        "text",
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/bmp",
        "audio/mpeg",
        "audio/wav",
        "audio/flac",
        "audio/mp4",
        "audio/ogg",
        "video/mp4",
        "video/quicktime",
        "video/x-msvideo",
        "video/x-ms-wmv",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
      },
    },
  },
  "mimo-v2.6-pro": {
    limit: {
      context: 1048576,
      output: 131072,
    },
    modalities: {
      input: [
        "text",
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/bmp",
        "audio/mpeg",
        "audio/wav",
        "audio/flac",
        "audio/mp4",
        "audio/ogg",
        "video/mp4",
        "video/quicktime",
        "video/x-msvideo",
        "video/x-ms-wmv",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
      },
    },
  },
  "minimax-m3": {
    limit: {
      context: 1000000,
      output: 131072,
    },
    modalities: {
      input: [
        "text",
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "video/mp4",
        "video/x-msvideo",
        "video/quicktime",
        "video/x-matroska",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        toggle: true,
      },
    },
  },
  "minimax-m3.1-flash": {
    limit: {
      context: 1000000,
      output: 512000,
    },
    modalities: {
      input: [
        "text",
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "video/mp4",
        "video/x-msvideo",
        "video/quicktime",
        "video/x-matroska",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["low", "medium", "high", "xhigh", "max"],
      },
    },
  },
  "longcat-2.0": {
    limit: {
      context: 1000000,
      output: 131072,
    },
    modalities: {
      input: ["text"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        toggle: true,
      },
    },
  },
  "step-5-preview": {
    limit: {
      context: 1000000,
      input: 1000000,
      output: 65536,
    },
    modalities: {
      input: [
        "text",
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "video/mp4",
        "video/quicktime",
        "video/x-matroska",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["low", "medium", "high"],
      },
    },
  },
  "beam-free": {
    limit: {
      context: 1048576,
      output: 131072,
    },
    modalities: {
      input: ["text"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["low", "medium", "high", "xhigh", "max"],
      },
    },
  },
  "qwen3.8-max": {
    limit: {
      context: 1000000,
      output: 131072,
    },
    modalities: {
      input: [
        "text",
        "image/bmp",
        "image/jpeg",
        "image/png",
        "image/tiff",
        "image/webp",
        "image/heic",
        "video/mp4",
        "video/x-msvideo",
        "video/x-matroska",
        "video/quicktime",
        "video/x-flv",
        "video/x-ms-wmv",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        toggle: true,
        effort: ["low", "medium", "xhigh"],
      },
    },
  },
  "qwen3.8-flash": {
    limit: {
      context: 1000000,
      output: 131072,
    },
    modalities: {
      input: [
        "text",
        "image/bmp",
        "image/jpeg",
        "image/png",
        "image/tiff",
        "image/webp",
        "image/heic",
        "video/mp4",
        "video/x-msvideo",
        "video/x-matroska",
        "video/quicktime",
        "video/x-flv",
        "video/x-ms-wmv",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        toggle: true,
        effort: ["low", "medium", "xhigh"],
      },
    },
  },
  "qwen3.7-plus": {
    limit: {
      context: 1000000,
      output: 65536,
    },
    modalities: {
      input: [
        "text",
        "image/bmp",
        "image/jpeg",
        "image/png",
        "image/tiff",
        "image/webp",
        "image/heic",
        "video/mp4",
        "video/x-msvideo",
        "video/x-matroska",
        "video/quicktime",
        "video/x-flv",
        "video/x-ms-wmv",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        toggle: true,
      },
    },
  },
  "kimi-k3.1-pro": {
    limit: {
      context: 1048576,
      output: 1048576,
    },
    modalities: {
      input: [
        "text",
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/bmp",
        "image/heic",
        "image/heif",
        "video/mp4",
        "video/mpeg",
        "video/mov",
        "video/avi",
        "video/x-flv",
        "video/mpg",
        "video/webm",
        "video/wmv",
        "video/3gpp",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        default: {
          type: "effort",
          value: "max",
        },
        effort: ["low", "high", "max"],
      },
    },
  },
  "iceman-contributor-free": {
    limit: {
      context: 262144,
      output: 131072,
    },
    modalities: {
      input: ["text"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
      },
    },
  },
  "gemini-4-argon": {
    limit: {
      context: 1048576,
      output: 65536,
    },
    modalities: {
      input: [
        "text",
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/heic",
        "image/heif",
        "video/mp4",
        "video/mpeg",
        "video/mov",
        "video/avi",
        "video/x-flv",
        "video/mpg",
        "video/webm",
        "video/wmv",
        "video/3gpp",
        "audio/wav",
        "audio/mp3",
        "audio/aiff",
        "audio/aac",
        "audio/ogg",
        "audio/flac",
        "audio/mpeg",
        "audio/m4a",
        "audio/l16",
        "audio/opus",
        "audio/alaw",
        "audio/mulaw",
        "audio/webm",
        "application/pdf",
      ],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["low", "medium", "high"],
      },
    },
  },
  hy4: {
    limit: {
      context: 1048576,
      input: 983010,
      output: 65536,
    },
    modalities: {
      input: ["text", "image/jpeg", "image/png", "image/webp", "image/gif"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        effort: ["none", "high"],
      },
    },
  },
  "longcat-2.5-free": {
    limit: {
      context: 1000000,
      output: 262144,
    },
    modalities: {
      input: ["text", "image"],
      output: ["text"],
    },
    capabilities: {
      tools: {
        supported: true,
      },
      reasoning: {
        supported: true,
        toggle: true,
      },
    },
  },
};
