#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getCv } from "./cv.js";

// Single source of truth for the version: package.json (one level above build/).
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const server = new McpServer({ name: "cv-tomas-francisco", version });

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ isError: true, content: [{ type: "text" as const, text: t }] });

// ---------- Tools ----------

server.registerTool(
  "get_cv",
  { description: "Devolve o CV completo do Tomás Francisco, em texto." },
  async () => {
    const cv = await getCv();
    return text(`Fonte: ${cv.source}\nAtualizado: ${cv.fetchedAt}\n\n${cv.fullText}`);
  }
);

server.registerTool(
  "list_sections",
  { description: "Lista os títulos das secções do CV (ex.: experiência, formação, competências)." },
  async () => {
    const cv = await getCv();
    return text(cv.sections.map((s) => `- ${s.title}`).join("\n"));
  }
);

server.registerTool(
  "get_section",
  {
    description: "Devolve o conteúdo de uma secção do CV. Usa list_sections para ver os nomes.",
    inputSchema: { name: z.string().describe("Nome (ou parte do nome) da secção") },
  },
  async ({ name }) => {
    const cv = await getCv();
    const q = name.trim().toLowerCase();
    // Prefer an exact title match, then fall back to a partial one.
    const match =
      cv.sections.find((s) => s.title.toLowerCase() === q) ??
      cv.sections.find((s) => s.title.toLowerCase().includes(q));
    if (!match) {
      return fail(`Secção "${name}" não encontrada. Disponíveis: ${cv.sections.map((s) => s.title).join(", ")}`);
    }
    return text(`## ${match.title}\n${match.content}`);
  }
);

server.registerTool(
  "search_cv",
  {
    description: "Pesquisa um termo (tecnologia, empresa, palavra-chave) no CV e devolve as linhas onde aparece.",
    inputSchema: { query: z.string().describe("Termo a procurar, ex.: 'TypeScript'") },
  },
  async ({ query }) => {
    const cv = await getCv();
    const q = query.toLowerCase();
    const hits: string[] = [];
    for (const s of cv.sections) {
      for (const line of s.content.split("\n")) {
        if (line.toLowerCase().includes(q)) hits.push(`[${s.title}] ${line}`);
      }
    }
    return text(hits.length ? hits.join("\n") : `Sem resultados para "${query}".`);
  }
);

// ---------- Resource ----------

server.registerResource(
  "cv-completo",
  "cv://completo",
  { title: "CV completo", description: "Texto integral do CV", mimeType: "text/plain" },
  async (uri) => {
    const cv = await getCv();
    return { contents: [{ uri: uri.href, mimeType: "text/plain", text: cv.fullText }] };
  }
);

// ---------- Prompt ----------

server.registerPrompt(
  "adaptar_cv_a_vaga",
  {
    description: "Analisa o CV face a uma descrição de vaga e sugere melhorias.",
    argsSchema: { vaga: z.string().describe("Descrição da vaga") },
  },
  ({ vaga }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text:
            `Usa a tool get_cv para ler o meu CV e compara-o com esta vaga. ` +
            `Diz-me que pontos destacar, o que falta e como reescrever o resumo.\n\nVaga:\n${vaga}`,
        },
      },
    ],
  })
);

// ---------- Startup (stdio) ----------
// Note: with stdio, never use console.log (it corrupts the protocol). Use console.error.

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("cv-mcp running on stdio");
