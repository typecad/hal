// ---------------------------------------------------------------------------
// Cuttlefish library catalog — the category taxonomy and npm keyword
// conventions behind `typecad-hal library search/init/validate`.
//
// The catalog has no registry service: npm keywords ARE the catalog. Every
// library package carries the marker keyword LIBRARY_MARKER_KEYWORD plus one
// category keyword (e.g. 'typecad-hal-led'). npm's search endpoint ANDs
// `keywords:` terms, so queries compose:
//
//   keywords:typecad-hal-library                     → every library
//   keywords:typecad-hal-library keywords:typecad-hal-led → the led category
//   keywords:typecad-hal-library ws2812              → free-text within libraries
// ---------------------------------------------------------------------------

/** The one keyword every typecad-hal library package must carry. */
export const LIBRARY_MARKER_KEYWORD = "typecad-hal-library";

/** Prefix for category keywords (`typecad-hal-<id>`). */
export const CATEGORY_KEYWORD_PREFIX = "typecad-hal-";

export interface LibraryCategory {
  /** Stable id used in --category flags, keywords, and docs. */
  id: string;
  /** Human label for prompts and tables. */
  label: string;
  /** One-line scope description. */
  description: string;
  /** Example parts the category covers (prompt/README guidance). */
  examples: string;
}

/**
 * The category taxonomy. Shared by search (query building + result shaping),
 * init (scaffold choices + keywords), validate (keyword consistency), and the
 * website's Library Packages page (rendered from the same list).
 */
export const LIBRARY_CATEGORIES: readonly LibraryCategory[] = [
  { id: "led", label: "LEDs", description: "LEDs, addressable strips, LED drivers", examples: "WS2812-class pixels, LED drivers, bar graphs" },
  { id: "display", label: "Displays", description: "Panels and panel drivers", examples: "TFT, OLED, e-ink" },
  { id: "sensor", label: "Sensors", description: "Measurement parts", examples: "environmental, motion, IMU, light, distance" },
  { id: "actuator", label: "Actuators", description: "Things that move or switch", examples: "motors, servos, steppers, relays" },
  { id: "comms", label: "Communications", description: "Radios and networking beyond built-in WiFi/BLE", examples: "LoRa, GSM, satellite, CAN add-ons" },
  { id: "storage", label: "Storage", description: "Persistent storage parts", examples: "SD cards, flash chips, FRAM" },
  { id: "audio", label: "Audio", description: "Sound input and output", examples: "microphones, amplifiers, codecs" },
  { id: "power", label: "Power", description: "Power management and monitoring", examples: "PMICs, battery gauges, chargers" },
  { id: "input", label: "Input", description: "Add-on human input", examples: "keypads, rotary encoders, add-on touch" },
  { id: "io", label: "I/O Expanders", description: "Extra I/O and simple drivers", examples: "port expanders, matrix drivers, 7-segment" },
  { id: "timing", label: "Timing", description: "Clocks and time sources", examples: "RTCs, precision clocks, GPS time" },
  { id: "utility", label: "Utility", description: "Pure-code helpers with no hardware of their own", examples: "formats, algorithms, protocol codecs" },
];

/** Look up a category by id (case-insensitive). */
export function libraryCategory(id: string): LibraryCategory | undefined {
  const lower = id.toLowerCase();
  return LIBRARY_CATEGORIES.find((c) => c.id === lower);
}

/** The npm keyword for a category (`typecad-hal-<id>`). */
export function categoryKeyword(id: string): string {
  return `${CATEGORY_KEYWORD_PREFIX}${id.toLowerCase()}`;
}

/**
 * Derive the category of an npm search result from its keywords. A package may
 * carry several category keywords; the first match in taxonomy order wins so
 * results are stable.
 */
export function categoryFromKeywords(keywords: readonly string[] | undefined): string | null {
  if (!keywords || keywords.length === 0) return null;
  const set = new Set(keywords.map((k) => k.toLowerCase()));
  for (const category of LIBRARY_CATEGORIES) {
    if (set.has(categoryKeyword(category.id))) return category.id;
  }
  return null;
}

/**
 * The keywords a library package should carry: the marker plus its category
 * keyword. Used by `library init` and checked by `library validate`.
 */
export function requiredLibraryKeywords(categoryId: string): string[] {
  return [LIBRARY_MARKER_KEYWORD, categoryKeyword(categoryId)];
}
