export interface SourceBlock {
  text: string;
  start: number;
  end: number;
  heading: string | null;
  locator: string;
  ordinal: number;
  isHeading: boolean;
}

interface RawBlock {
  text: string;
  start: number;
  end: number;
  heading: string | null;
  isHeading: boolean;
}

const PARAGRAPH_BREAK = /(?:\r?\n)[ \t]*(?:\r?\n)+/g;
const HEADING = /^(#{1,6})[ \t]+(.+)$/;

/**
 * Split source text into display blocks while keeping exact UTF-16 offsets.
 * The offsets are what get stored as evidence anchors.
 */
export function splitSourceBlocks(content: string): SourceBlock[] {
  const raw: RawBlock[] = [];
  let activeHeading: string | null = null;
  let cursor = 0;

  const pushSegment = (segmentStart: number, segmentEnd: number) => {
    const segment = content.slice(segmentStart, segmentEnd);
    if (!segment.trim()) return;
    const leading = segment.length - segment.trimStart().length;
    const trailing = segment.length - segment.trimEnd().length;
    const body = segment.slice(leading, segment.length - trailing);
    const bodyStart = segmentStart + leading;
    if (!body) return;

    const firstBreak = body.search(/\r?\n/);
    const firstLine = firstBreak >= 0 ? body.slice(0, firstBreak) : body;
    const match = HEADING.exec(firstLine);

    if (match) {
      activeHeading = match[2].trim();
      const headingText = activeHeading;
      const offset = body.indexOf(headingText);
      if (offset >= 0) {
        raw.push({
          text: headingText,
          start: bodyStart + offset,
          end: bodyStart + offset + headingText.length,
          heading: activeHeading,
          isHeading: true,
        });
      }
      if (firstBreak >= 0) {
        const restRaw = body.slice(firstBreak + 1);
        const rest = restRaw.trim();
        if (rest) {
          const restOffset = body.indexOf(rest, firstBreak + 1);
          raw.push({
            text: rest,
            start: bodyStart + restOffset,
            end: bodyStart + restOffset + rest.length,
            heading: activeHeading,
            isHeading: false,
          });
        }
      }
      return;
    }

    raw.push({
      text: body,
      start: bodyStart,
      end: bodyStart + body.length,
      heading: activeHeading,
      isHeading: false,
    });
  };

  let match: RegExpExecArray | null;
  PARAGRAPH_BREAK.lastIndex = 0;
  while ((match = PARAGRAPH_BREAK.exec(content)) !== null) {
    pushSegment(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  pushSegment(cursor, content.length);

  return raw.map((block, index) => ({
    ...block,
    ordinal: index + 1,
    locator: block.heading ? `§${block.heading} · 第 ${index + 1} 段` : `第 ${index + 1} 段`,
  }));
}

export function sourceKicker(origin: string): string {
  if (origin === 'sample') return 'Sample dossier';
  if (origin === 'external') return 'External fragment';
  if (origin === 'revision') return 'Revised source';
  return 'Imported source';
}

export function contentHashShort(hash: string): string {
  return hash.slice(0, 10);
}
