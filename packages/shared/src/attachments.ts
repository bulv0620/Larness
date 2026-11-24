/**
 * One whitelist for the whole attachment pipeline. The upload dialog, the
 * client-side guard and the server sniffer all read these constants, so a type
 * accepted in the composer cannot be rejected later (and vice versa).
 *
 * Text formats are source-view capable: the original UTF-8 bytes stay readable
 * through `read_attachment view:"source"`, which is what coding tasks need for
 * HTML/CSS/config files that Markdown conversion would lose.
 */

export const DOCUMENT_ATTACHMENT_EXTENSIONS = ["pdf", "docx", "pptx", "xlsx"] as const;

export const IMAGE_ATTACHMENT_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;

/** Source code, markup, configuration and other plain-text formats. */
export const TEXT_ATTACHMENT_EXTENSIONS = [
  // prose and data
  "txt",
  "md",
  "markdown",
  "rst",
  "log",
  "csv",
  "tsv",
  // markup and styles
  "html",
  "htm",
  "xml",
  "svg",
  "css",
  "scss",
  "sass",
  "less",
  "vue",
  "svelte",
  "astro",
  // structured configuration
  "json",
  "jsonc",
  "json5",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "cfg",
  "properties",
  "gradle",
  "lock",
  // code
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "hpp",
  "cs",
  "php",
  "swift",
  "scala",
  "lua",
  "pl",
  "r",
  "dart",
  "ex",
  "exs",
  "erl",
  "clj",
  "hs",
  "zig",
  "sol",
  "sql",
  "graphql",
  "gql",
  "proto",
  "sh",
  "bash",
  "zsh",
  "ps1",
] as const;

/** Basenames without a useful extension that are still plain text. */
export const TEXT_ATTACHMENT_FILENAMES = [
  "dockerfile",
  "makefile",
  "rakefile",
  "gemfile",
  "procfile",
  "brewfile",
  "justfile",
  "license",
  "readme",
  "changelog",
  ".gitignore",
  ".gitattributes",
  ".dockerignore",
  ".editorconfig",
  ".nvmrc",
  ".node-version",
  ".python-version",
  ".prettierrc",
  ".eslintrc",
  ".babelrc",
  ".env.example",
  ".env.sample",
  ".env.template",
] as const;

/**
 * Credentials are never accepted, not even as text: an attachment is shown in
 * the transcript and injected into the model context, so a pasted key would be
 * logged, cached and sent to the provider.
 */
const SECRET_FILENAMES = new Set([
  ".env",
  ".npmrc",
  ".netrc",
  ".git-credentials",
  ".htpasswd",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "credentials",
]);

const SECRET_EXTENSIONS = new Set([
  "pem",
  "key",
  "p12",
  "pfx",
  "jks",
  "keystore",
  "ppk",
  "asc",
  "gpg",
  "kdbx",
]);

const SECRET_ENV_VARIANTS = /^\.env(\..+)?$/;

/** Binary or archive formats that v1 rejects outright. */
export const BLOCKED_ATTACHMENT_EXTENSIONS = new Set([
  "exe",
  "dll",
  "so",
  "dylib",
  "jar",
  "class",
  "msi",
  "apk",
  "wasm",
  "com",
  "scr",
  "cpl",
  "sys",
  "doc",
  "ppt",
  "xls",
  "zip",
  "rar",
  "7z",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "tar",
  "mp3",
  "mp4",
  "mov",
  "avi",
  "wav",
  "ogg",
  "webm",
  "mkv",
  "flac",
  "bmp",
  "tif",
  "tiff",
  "ico",
  "heic",
  "psd",
  "ai",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
]);

/** MIME types whose original bytes are readable as text. */
export const SOURCE_VIEW_MIMES = ["text/plain", "text/markdown", "text/csv", "text/html"] as const;

export function isSourceViewMime(mime: string): boolean {
  return (SOURCE_VIEW_MIMES as readonly string[]).includes(mime);
}

/** Lower-cased basename without directories. */
export function attachmentBasename(filename: string): string {
  const normalized = filename.replaceAll("\\", "/");
  return (normalized.split("/").at(-1) ?? "").toLowerCase();
}

/** Lower-cased extension without the dot; "" for dotfiles and bare names. */
export function attachmentExtensionOf(filename: string): string {
  const basename = attachmentBasename(filename);
  const dot = basename.lastIndexOf(".");
  if (dot <= 0 || dot === basename.length - 1) return "";
  return basename.slice(dot + 1);
}

export function isSecretAttachmentName(filename: string): boolean {
  const basename = attachmentBasename(filename);
  if (SECRET_FILENAMES.has(basename)) return true;
  const dotenv = SECRET_ENV_VARIANTS.exec(basename);
  if (dotenv !== null) {
    const suffix = dotenv[1] ?? "";
    if (suffix === ".example" || suffix === ".sample" || suffix === ".template") return false;
    return true;
  }
  return SECRET_EXTENSIONS.has(attachmentExtensionOf(basename));
}

export function isBlockedAttachmentName(filename: string): boolean {
  return BLOCKED_ATTACHMENT_EXTENSIONS.has(attachmentExtensionOf(filename));
}

const ACCEPTED_EXTENSIONS = new Set<string>([
  ...DOCUMENT_ATTACHMENT_EXTENSIONS,
  ...IMAGE_ATTACHMENT_EXTENSIONS,
  ...TEXT_ATTACHMENT_EXTENSIONS,
]);

const ACCEPTED_FILENAMES = new Set<string>(TEXT_ATTACHMENT_FILENAMES);

/** Extension or basename allow-list check; secrets are rejected separately. */
export function isAcceptedAttachmentName(filename: string): boolean {
  const basename = attachmentBasename(filename);
  if (ACCEPTED_FILENAMES.has(basename)) return true;
  return ACCEPTED_EXTENSIONS.has(attachmentExtensionOf(basename));
}

/** `accept` attribute for the file input; the JS guard is authoritative. */
export const ATTACHMENT_ACCEPT = [...ACCEPTED_EXTENSIONS]
  .sort()
  .map((extension) => `.${extension}`)
  .join(",");

export type AttachmentRejection = "secret" | "type" | "size";

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/** Shared pre-upload guard so client and server agree on the reason. */
export function attachmentRejection(
  filename: string,
  size: number,
  maxBytes: number = ATTACHMENT_MAX_BYTES,
): AttachmentRejection | null {
  if (isSecretAttachmentName(filename)) return "secret";
  if (size > maxBytes) return "size";
  if (!isAcceptedAttachmentName(filename)) return "type";
  return null;
}
