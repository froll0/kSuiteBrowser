/**
 * Incremental parser for OpenAI-style streaming responses (server-sent events):
 * feed it chunks of text, get back the content deltas as they complete.
 */
export class ChatStreamParser {
  private buffer = '';
  done = false;

  push(chunk: string): string[] {
    this.buffer += chunk;
    const deltas: string[] = [];
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      const delta = this.line(line);
      if (delta) deltas.push(delta);
    }
    return deltas;
  }

  /** Whatever is left when the stream ends without a final newline. */
  flush(): string[] {
    const rest = this.buffer;
    this.buffer = '';
    const delta = rest ? this.line(rest) : null;
    return delta ? [delta] : [];
  }

  private line(line: string): string | null {
    if (!line.startsWith('data:')) return null;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') {
      this.done = true;
      return null;
    }
    try {
      const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
      const choice = json.choices?.[0];
      return choice?.delta?.content ?? choice?.message?.content ?? null;
    } catch {
      return null;
    }
  }
}
