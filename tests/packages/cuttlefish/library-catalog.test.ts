import { describe, it, expect } from 'vitest';
import {
  LIBRARY_CATEGORIES,
  LIBRARY_MARKER_KEYWORD,
  libraryCategory,
  categoryKeyword,
  categoryFromKeywords,
  requiredLibraryKeywords,
} from '../../../packages/cuttlefish/src/library/catalog';

describe('library catalog taxonomy', () => {
  it('has unique ids and category keywords', () => {
    const ids = new Set(LIBRARY_CATEGORIES.map((c) => c.id));
    const keywords = new Set(LIBRARY_CATEGORIES.map((c) => categoryKeyword(c.id)));
    expect(ids.size).toBe(LIBRARY_CATEGORIES.length);
    expect(keywords.size).toBe(LIBRARY_CATEGORIES.length);
  });

  it('covers the core embedded peripheral families', () => {
    // The taxonomy must keep growing organically, but these are the floor.
    for (const id of ['led', 'display', 'sensor', 'actuator', 'comms', 'storage', 'utility']) {
      expect(libraryCategory(id), id).toBeDefined();
    }
  });

  it('looks up categories case-insensitively and rejects unknowns', () => {
    expect(libraryCategory('LED')?.id).toBe('led');
    expect(libraryCategory('not-a-thing')).toBeUndefined();
  });

  it('derives keywords and categories symmetrically', () => {
    expect(categoryKeyword('led')).toBe('typecad-hal-led');
    expect(categoryFromKeywords(['typecad-hal-library', 'typecad-hal-led'])).toBe('led');
    // Taxonomy order wins when several category keywords are present.
    expect(categoryFromKeywords(['typecad-hal-sensor', 'typecad-hal-led'])).toBe('led');
    expect(categoryFromKeywords(['typecad-hal-library'])).toBeNull();
    expect(categoryFromKeywords(undefined)).toBeNull();
  });

  it('required keywords are the marker plus the category', () => {
    expect(requiredLibraryKeywords('display')).toEqual([LIBRARY_MARKER_KEYWORD, 'typecad-hal-display']);
  });
});
