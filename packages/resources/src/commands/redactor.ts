const PREFIX =
  /(authorization|api[_-]?key|token|password|cookie|secret)["']?\s{0,16}[:=]\s{0,16}(["']?)/i;
const DELIMITER = /[\s"'&;,}]/;
export class OutputRedactor {
  #pending = "";
  #suppress = false;
  #quote = "";
  #escaped = false;
  #header = false;
  #awaitValue = false;

  readonly #secrets: string[];
  constructor(secrets: string[]) {
    if (secrets.some((secret) => secret.length > 65_536))
      throw new Error("Unsupported secret size");
    this.#secrets = secrets.filter(Boolean);
  }
  #safeLength(): number {
    let held = 0;
    for (const secret of this.#secrets) {
      for (
        let length = Math.min(this.#pending.length, secret.length - 1);
        length > held;
        length--
      ) {
        if (this.#pending.endsWith(secret.slice(0, length))) {
          held = length;
          break;
        }
      }
    }
    const tail = this.#pending.slice(-64).toLowerCase();
    for (let index = 0; index < tail.length; index++) {
      const suffix = tail.slice(index);
      if (
        [
          "authorization",
          "apikey",
          "api_key",
          "api-key",
          "token",
          "password",
          "cookie",
          "secret",
        ].some(
          (label) =>
            label.startsWith(suffix) ||
            (suffix.startsWith(label) &&
              /^["']?\s{0,16}(?:[:=]\s{0,16}["']?)?$/.test(suffix.slice(label.length))),
        )
      ) {
        held = Math.max(held, suffix.length);
        break;
      }
    }
    return this.#pending.length - held;
  }
  push(text: string, final = false): string {
    this.#pending += text;
    let output = "";
    while (this.#pending.length) {
      if (this.#suppress) {
        if (this.#awaitValue) {
          this.#pending = this.#pending.replace(/^[ \t]+/, "");
          if (!this.#pending.length) break;
          this.#awaitValue = false;
          const first = this.#pending[0];
          if (first === '"' || first === "'") {
            this.#quote = first;
            output += `${first}[Redacted]`;
            this.#pending = this.#pending.slice(1);
          } else if (first === "\r" || first === "\n") {
            this.#suppress = false;
            continue;
          } else output += "[Redacted]";
        }
        let end = -1;
        if (this.#quote) {
          for (let i = 0; i < this.#pending.length; i++) {
            const char = this.#pending[i];
            if (this.#escaped) {
              this.#escaped = false;
              continue;
            }
            if (char === "\\") {
              this.#escaped = true;
              continue;
            }
            if (char === this.#quote) {
              end = i;
              break;
            }
          }
        } else end = this.#pending.search(this.#header ? /[\r\n]/ : DELIMITER);
        if (end < 0) {
          this.#pending = "";
          break;
        }
        this.#pending = this.#pending.slice(end);
        this.#suppress = false;
      }
      const safe = final ? this.#pending.length : this.#safeLength();
      const prefix = PREFIX.exec(this.#pending);
      let index = prefix?.index ?? Infinity;
      let length = prefix?.[0].length ?? 0;
      let field = !!prefix;
      for (const secret of this.#secrets) {
        const found = this.#pending.indexOf(secret);
        if (
          found >= 0 &&
          (found < index || (found === index && !field && secret.length > length))
        ) {
          index = found;
          length = secret.length;
          field = false;
        }
      }
      if (index >= safe && !(field && index === 0)) {
        if (!safe) break;
        output += this.#pending.slice(0, safe);
        this.#pending = this.#pending.slice(safe);
        continue;
      }
      const awaiting = !final && field && !prefix?.[2] && index + length === this.#pending.length;
      let label = field ? this.#pending.slice(index, index + length) : "";
      for (const secret of this.#secrets) label = label.replaceAll(secret, "[Redacted]");
      output += `${this.#pending.slice(0, index)}${label}${awaiting ? "" : "[Redacted]"}`;
      this.#pending = this.#pending.slice(index + length);
      this.#suppress = field;
      this.#awaitValue = awaiting;
      this.#quote = field ? (prefix?.[2] ?? "") : "";
      this.#header = field && /^(authorization|cookie)$/i.test(prefix?.[1] ?? "");
      this.#escaped = false;
    }
    return output;
  }
}
