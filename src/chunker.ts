/**
 * Chunks session JSONL transcripts into semantic chunks for ingestion.
 *
 * Chunking rules from DESIGN.md:
 * - Max chunk: 512 tokens (~2048 chars approximation)
 * - User + assistant pair combined when < 512 tokens
 * - Long responses split at paragraph boundaries
 * - Tool results > 200 tokens stored but not embedded (except errors)
 * - Consecutive system messages collapsed, not embedded
 */

const MAX_CHUNK_CHARS = 2048; // ~512 tokens
const TOOL_RESULT_EMBED_THRESHOLD = 800; // ~200 tokens in chars

export interface RawMessage {
  type: string; // 'human' | 'assistant' | 'tool_use' | 'tool_result' | 'system'
  content?: string;
  tool_name?: string;
  is_error?: boolean;
  [key: string]: unknown;
}

export interface Chunk {
  role: string;
  content: string;
  chunkType: string;
  isSignal: boolean;
  sequence: number;
  tokensApprox: number;
  metadata?: string;
  createdAt: number;
}

export function chunkSession(
  messages: RawMessage[],
  sessionTimestamp: number
): Chunk[] {
  const chunks: Chunk[] = [];
  let sequence = 0;
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    // Skip empty messages
    if (!msg.content && msg.type !== "tool_use") {
      i++;
      continue;
    }

    // System messages: collapse consecutive, don't embed
    if (msg.type === "system") {
      const systemParts: string[] = [];
      while (i < messages.length && messages[i].type === "system") {
        if (messages[i].content) systemParts.push(messages[i].content!);
        i++;
      }
      if (systemParts.length > 0) {
        chunks.push({
          role: "system",
          content: systemParts.join("\n---\n"),
          chunkType: "system",
          isSignal: false,
          sequence: sequence++,
          tokensApprox: estimateTokens(systemParts.join("\n")),
          createdAt: sessionTimestamp,
        });
      }
      continue;
    }

    // User + assistant pair: try to combine if short enough
    if (
      msg.type === "human" &&
      i + 1 < messages.length &&
      messages[i + 1].type === "assistant"
    ) {
      const userContent = msg.content ?? "";
      const assistantContent = messages[i + 1].content ?? "";
      const combined = `User: ${userContent}\n\nAssistant: ${assistantContent}`;

      if (combined.length <= MAX_CHUNK_CHARS) {
        chunks.push({
          role: "conversation",
          content: combined,
          chunkType: "conversation",
          isSignal: true,
          sequence: sequence++,
          tokensApprox: estimateTokens(combined),
          createdAt: sessionTimestamp,
        });
        i += 2;
        continue;
      }
    }

    if (msg.type === "human") {
      const content = msg.content ?? "";
      for (const part of splitAtParagraphs(content)) {
        chunks.push({
          role: "user",
          content: part,
          chunkType: "conversation",
          isSignal: true,
          sequence: sequence++,
          tokensApprox: estimateTokens(part),
          createdAt: sessionTimestamp,
        });
      }
      i++;
      continue;
    }

    if (msg.type === "assistant") {
      const content = msg.content ?? "";
      for (const part of splitAtParagraphs(content)) {
        chunks.push({
          role: "assistant",
          content: part,
          chunkType: "conversation",
          isSignal: true,
          sequence: sequence++,
          tokensApprox: estimateTokens(part),
          createdAt: sessionTimestamp,
        });
      }
      i++;
      continue;
    }

    if (msg.type === "tool_use") {
      const content = msg.content ?? JSON.stringify(msg);
      chunks.push({
        role: "tool",
        content,
        chunkType: "tool_call",
        isSignal: true, // Code changes are signal
        sequence: sequence++,
        tokensApprox: estimateTokens(content),
        metadata: msg.tool_name
          ? JSON.stringify({ tool: msg.tool_name })
          : undefined,
        createdAt: sessionTimestamp,
      });
      i++;
      continue;
    }

    if (msg.type === "tool_result") {
      const content = msg.content ?? "";
      const isError = msg.is_error === true;
      const isShort = content.length <= TOOL_RESULT_EMBED_THRESHOLD;

      chunks.push({
        role: "tool_result",
        content,
        chunkType: "tool_result",
        isSignal: isError || isShort, // Errors always embedded, short results too
        sequence: sequence++,
        tokensApprox: estimateTokens(content),
        metadata: isError ? JSON.stringify({ is_error: true }) : undefined,
        createdAt: sessionTimestamp,
      });
      i++;
      continue;
    }

    const content = msg.content ?? JSON.stringify(msg);
    chunks.push({
      role: msg.type,
      content,
      chunkType: "conversation",
      isSignal: true,
      sequence: sequence++,
      tokensApprox: estimateTokens(content),
      createdAt: sessionTimestamp,
    });
    i++;
  }

  return chunks;
}

function splitAtParagraphs(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const paragraphs = text.split(/\n\n+/);
  const parts: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > MAX_CHUNK_CHARS) {
      if (current) parts.push(current.trim());
      // If single paragraph is too long, split at sentence boundaries
      if (para.length > MAX_CHUNK_CHARS) {
        parts.push(...splitAtSentences(para));
      } else {
        current = para;
      }
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) parts.push(current.trim());

  return parts.length > 0 ? parts : [text.slice(0, MAX_CHUNK_CHARS)];
}

function splitAtSentences(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) ?? [text];
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > MAX_CHUNK_CHARS) {
      if (current) parts.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) parts.push(current.trim());

  return parts;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
