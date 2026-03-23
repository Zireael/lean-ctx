import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionCache } from '../core/session-cache.js';
import { extractSignatures } from '../core/signature-extractor.js';
import { formatCompactSignature, shortenPath } from '../core/protocol.js';
import { countTokens } from '../core/token-counter.js';
import { recordToolCall } from '../core/store.js';

export function registerCtxCompress(server: McpServer, cache: SessionCache): void {
  server.tool(
    'ctx_compress',
    `Compress the current session context into a minimal checkpoint.
Returns a ultra-compact summary of all files in cache with their signatures,
cache stats, and key state. Use this when conversation gets long (>10 turns)
to create a "memory snapshot" that replaces verbose history.
The output can serve as context for a fresh conversation.`,
    {
      include_signatures: z
        .boolean()
        .optional()
        .describe('Include compact function signatures for each cached file (default: true)'),
      include_changes: z
        .boolean()
        .optional()
        .describe('Include a summary of detected file changes (default: true)'),
    },
    async ({ include_signatures = true, include_changes = true }) => {
      const entries = cache.getAllEntries();
      const fileCount = entries.length;

      if (fileCount === 0) {
        return textResult('No files in context yet.');
      }

      const sections: string[] = [];
      let totalOriginalTokens = 0;
      let totalCompressedTokens = 0;

      sections.push(`CTX CHECKPOINT (${fileCount} files)`);
      sections.push('');

      for (const [absPath, entry] of entries) {
        const short = shortenPath(absPath);
        const ref = cache.getFileRef(absPath);
        const lineInfo = `${entry.lineCount}L`;

        totalOriginalTokens += countTokens(entry.content);

        if (include_signatures) {
          const sigs = extractSignatures(entry.content, absPath);
          if (sigs.signatures.length > 0) {
            const compactSigs = sigs.signatures
              .map(formatCompactSignature)
              .filter(Boolean)
              .join(', ');
            const line = `${ref} ${short} [${lineInfo}]: ${compactSigs}`;
            sections.push(line);
            totalCompressedTokens += countTokens(line);
          } else {
            const line = `${ref} ${short} [${lineInfo}]`;
            sections.push(line);
            totalCompressedTokens += countTokens(line);
          }
        } else {
          const line = `${ref} ${short} [${lineInfo}]`;
          sections.push(line);
          totalCompressedTokens += countTokens(line);
        }
      }

      if (include_changes) {
        const changedFiles = entries.filter(([, e]) => e.readCount > 1);
        if (changedFiles.length > 0) {
          sections.push('');
          sections.push('CHANGES:');
          for (const [absPath, entry] of changedFiles) {
            const short = shortenPath(absPath);
            sections.push(`  ${short}: ${entry.readCount} reads`);
          }
        }
      }

      const cacheStats = cache.getStats();
      sections.push('');
      sections.push(`STATS: ${cacheStats.totalReads} reads, ${cacheStats.cacheHits} hits (${cacheStats.hitRate}%)`);

      const output = sections.join('\n');
      totalCompressedTokens = countTokens(output);
      const saved = totalOriginalTokens - totalCompressedTokens;
      const pct = totalOriginalTokens > 0 ? Math.round((saved / totalOriginalTokens) * 100) : 0;

      recordToolCall('ctx_compress', totalOriginalTokens, saved, undefined, 'checkpoint');

      sections.push(`COMPRESSION: ${totalOriginalTokens} -> ${totalCompressedTokens} tok (${pct}% saved)`);

      return textResult(sections.join('\n'));
    }
  );
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
