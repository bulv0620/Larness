const PREFIX =
  /(authorization|api[_-]?key|token|password|cookie|secret)["']?\s{0,16}[:=]\s{0,16}(["']?)/i;
const DELIMITER = /[\s"'&;,}]/;
export class OutputRedactor {
  #pending = "";
  #suppress = false;
  #quote = "";
  #escaped = false;
  #header = false;
  readonly #hold: number;
  readonly #secrets: string[];
  constructor(secrets: string[]) {
    if (secrets.some((secret) => secret.length > 65_536))
      throw new Error("Unsupported secret size");
    this.#secrets = secrets.filter(Boolean);
    this.#hold = Math.max(256, ...this.#secrets.map((secret) => secret.length));
  }
  push(text: string, final = false): string {
    this.#pending += text;
    let output = "";
    while (this.#pending.length && (final || this.#suppress || this.#pending.length > this.#hold)) {
      if (this.#suppress) {
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
      const safe = final ? this.#pending.length : Math.max(0, this.#pending.length - this.#hold);
      if (!safe) break;
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
      if (index >= safe) {
        output += this.#pending.slice(0, safe);
        this.#pending = this.#pending.slice(safe);
        continue;
      }
      let label = field ? this.#pending.slice(index, index + length) : "";
      for (const secret of this.#secrets) label = label.replaceAll(secret, "[Redacted]");
      output += `${this.#pending.slice(0, index)}${label}[Redacted]`;
      this.#pending = this.#pending.slice(index + length);
      this.#suppress = field;
      this.#quote = field ? (prefix?.[2] ?? "") : "";
      this.#header = field && /^(authorization|cookie)$/i.test(prefix?.[1] ?? "");
      this.#escaped = false;
    }
    return output;
  }
}
