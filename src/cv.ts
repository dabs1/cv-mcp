export interface Section {
  title: string;
  content: string;
}

export interface Cv {
  source: string;
  fetchedAt: string;
  sections: Section[];
  fullText: string;
}

// Full URL of the backend endpoint, e.g. https://your-backend.example.com/api/cv
const CV_API_URL = process.env.CV_API_URL;
const CACHE_TTL_MS = 10 * 60 * 1000;
// Free-tier backends can take ~1 min to "wake up" on the first request.
const TIMEOUT_MS = 60_000;

/** Technical fields (MongoDB / Spring) that mean nothing to someone reading the CV. */
const INTERNAL_KEYS = new Set(["id", "_id", "_class"]);

let cache: { cv: Cv; at: number } | null = null;

export async function getCv(): Promise<Cv> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.cv;
  if (!CV_API_URL) {
    throw new Error(
      "A variável de ambiente CV_API_URL não está definida. " +
        "Define-a no claude_desktop_config.json com o URL do endpoint /api/cv do teu backend."
    );
  }

  const res = await fetch(CV_API_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err: unknown) => {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(
        `O backend não respondeu em ${TIMEOUT_MS / 1000}s (pode estar a acordar). Tenta de novo dentro de instantes.`
      );
    }
    throw new Error(`Não foi possível contactar o backend: ${err instanceof Error ? err.message : String(err)}`);
  });
  if (!res.ok) throw new Error(`Falha a obter ${CV_API_URL}: HTTP ${res.status}`);

  const cv = buildCv(CV_API_URL, await res.json());
  cache = { cv, at: Date.now() };
  return cv;
}

/** JSON.stringify replacer that strips the internal fields at any depth. */
const dropInternal = (key: string, value: unknown) => (INTERNAL_KEYS.has(key) ? undefined : value);

/** Each top-level key of the JSON (experience, education, skills...) becomes a section. */
function buildCv(source: string, data: unknown): Cv {
  let root: unknown = data;
  if (Array.isArray(root) && root.length === 1) root = root[0];

  const entries: [string, unknown][] =
    root && typeof root === "object" && !Array.isArray(root)
      ? Object.entries(root as Record<string, unknown>)
      : [["cv", root]];

  const sections: Section[] = entries
    .filter(([title]) => !INTERNAL_KEYS.has(title))
    .map(([title, value]) => ({
      title,
      content: typeof value === "string" ? value : (JSON.stringify(value, dropInternal, 2) ?? ""),
    }));

  return {
    source,
    fetchedAt: new Date().toISOString(),
    sections,
    fullText: sections.map((s) => `## ${s.title}\n${s.content}`).join("\n\n"),
  };
}
