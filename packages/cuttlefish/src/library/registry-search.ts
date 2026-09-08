// ---------------------------------------------------------------------------
// npm registry search for typecad-hal library packages — the discovery client
// behind `typecad-hal library search`.
//
// Ports the concept from the typecad binary's `typecad package` command: the
// npm registry's search endpoint is the catalog, keywords are the taxonomy.
// The marker keyword (typecad-hal-library) is always part of the query; a
// category narrows it; free text ANDs on top. The endpoint ANDs `keywords:`
// terms, so the composition needs no client-side filtering.
// ---------------------------------------------------------------------------

import { LIBRARY_MARKER_KEYWORD, categoryKeyword, categoryFromKeywords } from "./catalog.js";

/** Fields of an npm search result this module consumes. */
export interface NpmSearchPackage {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  links?: { npm?: string };
  publisher?: { username?: string };
  date?: string;
}

interface NpmSearchResponse {
  objects: Array<{ package: NpmSearchPackage }>;
  total: number;
}

/** One shaped search result. */
export interface LibrarySearchResult {
  name: string;
  version: string;
  description: string | null;
  /** Category id derived from the package's keywords, or null. */
  category: string | null;
  npmUrl: string;
  published: string | null;
}

const REGISTRY_SEARCH_ENDPOINT = "https://registry.npmjs.org/-/v1/search";

/**
 * Build the `text=` query for the registry search endpoint. Exported for tests.
 */
export function buildLibrarySearchQuery(text?: string, categoryId?: string): string {
  const terms = [`keywords:${LIBRARY_MARKER_KEYWORD}`];
  if (categoryId) {
    terms.push(`keywords:${categoryKeyword(categoryId)}`);
  }
  const freeText = text?.trim();
  if (freeText) {
    // Free text terms are space-separated; the registry ANDs them.
    terms.push(freeText);
  }
  return terms.join(" ");
}

/**
 * Search npm for typecad-hal library packages. `size` caps results (registry
 * max is 250). Throws on HTTP failure — the CLI surfaces the message.
 */
export async function searchLibraryPackages(
  text?: string,
  categoryId?: string,
  size = 250,
): Promise<LibrarySearchResult[]> {
  const url = `${REGISTRY_SEARCH_ENDPOINT}?text=${encodeURIComponent(buildLibrarySearchQuery(text, categoryId))}&size=${size}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`npm registry returned ${res.status}: ${res.statusText}`);
  }
  const data = (await res.json()) as NpmSearchResponse;
  return data.objects.map((o) => shapeResult(o.package));
}

export function shapeResult(pkg: NpmSearchPackage): LibrarySearchResult {
  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description ?? null,
    category: categoryFromKeywords(pkg.keywords),
    npmUrl: pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
    published: pkg.date ?? null,
  };
}
