/**
 * Parser for the libgdx `.atlas` text format that Spine exports/imports.
 * Supports both the legacy layout (`xy:`/`size:`/`orig:`/`offset:` keys) and
 * the Spine 4.x layout (`bounds:`/`offsets:`), including rotated regions.
 * The editor uses this to slice a packed page back into per-region images.
 */

export interface AtlasRegion {
  name: string;
  /** Position and packed size inside the page (already swapped when rotated). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when the region is stored rotated 90° clockwise in the page. */
  rotate: boolean;
  /** Whitespace-strip offsets from the original image's bottom-left. */
  offsetX: number;
  offsetY: number;
  origWidth: number;
  origHeight: number;
}

export interface AtlasPage {
  /** Image file name, e.g. "skeleton.png". */
  name: string;
  regions: AtlasRegion[];
}

/** Parses `.atlas` text into pages with their regions. */
export function parseAtlas(text: string): AtlasPage[] {
  const lines = text.split(/\r?\n/);
  const pages: AtlasPage[] = [];
  let page: AtlasPage | null = null;
  let region: AtlasRegion | null = null;
  let i = 0;

  const finishRegion = () => {
    if (region && page) {
      if (region.origWidth === 0) region.origWidth = region.width;
      if (region.origHeight === 0) region.origHeight = region.height;
      page.regions.push(region);
    }
    region = null;
  };

  while (i < lines.length) {
    const raw = lines[i]!;
    i++;
    const line = raw.trim();
    if (line === '') {
      // Blank line separates pages.
      finishRegion();
      page = null;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 0) {
      // A bare name: the first after a blank line is the page image, the rest
      // are region names (region names may repeat with an index key).
      if (!page) {
        page = { name: line, regions: [] };
        pages.push(page);
      } else {
        finishRegion();
        region = {
          name: line,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          rotate: false,
          offsetX: 0,
          offsetY: 0,
          origWidth: 0,
          origHeight: 0,
        };
      }
      continue;
    }
    const key = line.slice(0, colon).trim();
    const values = line
      .slice(colon + 1)
      .split(',')
      .map((v) => v.trim());
    const num = (idx: number) => Number(values[idx] ?? 0);
    if (!region) continue; // page-level keys (size/format/filter/repeat/pma)
    switch (key) {
      case 'xy':
        region.x = num(0);
        region.y = num(1);
        break;
      case 'size':
        region.width = num(0);
        region.height = num(1);
        break;
      case 'bounds':
        region.x = num(0);
        region.y = num(1);
        region.width = num(2);
        region.height = num(3);
        break;
      case 'orig':
        region.origWidth = num(0);
        region.origHeight = num(1);
        break;
      case 'offset':
        region.offsetX = num(0);
        region.offsetY = num(1);
        break;
      case 'offsets':
        region.offsetX = num(0);
        region.offsetY = num(1);
        region.origWidth = num(2);
        region.origHeight = num(3);
        break;
      case 'rotate':
        region.rotate = values[0] === 'true' || values[0] === '90';
        break;
      default:
        break; // index, split, pad, etc. — irrelevant for unpacking
    }
  }
  finishRegion();
  return pages;
}
