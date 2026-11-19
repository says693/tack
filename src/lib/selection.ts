export interface SelectionInfo {
  exact: string;
  prefix: string;
  suffix: string;
  startUtf16: number;
  endUtf16: number;
  heading: string | null;
  locator: string | null;
  rect: DOMRect | null;
}

function blockStart(block: Element): number {
  return Number(block.getAttribute('data-start') ?? '0');
}

function blockEnd(block: Element): number {
  return Number(block.getAttribute('data-end') ?? '0');
}

function blockHeading(block: Element): string | null {
  return block.getAttribute('data-heading');
}

function blockLocator(block: Element): string | null {
  return block.getAttribute('data-locator');
}

function offsetWithinBlock(block: Element, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(block);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  return range.toString().length;
}

export function readSelection(
  content: string,
  article: HTMLElement | null,
): SelectionInfo | null {
  if (!article) return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const startElement =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  const endElement =
    range.endContainer.nodeType === Node.ELEMENT_NODE
      ? (range.endContainer as Element)
      : range.endContainer.parentElement;
  const startBlock = startElement?.closest('[data-start]');
  const endBlock = endElement?.closest('[data-start]');
  if (!startBlock || !endBlock || !article.contains(startBlock) || !article.contains(endBlock)) {
    return null;
  }
  let start = blockStart(startBlock) + offsetWithinBlock(startBlock, range.startContainer, range.startOffset);
  let end = blockStart(endBlock) + offsetWithinBlock(endBlock, range.endContainer, range.endOffset);
  if (end < start) [start, end] = [end, start];
  // Trim whitespace at both ends while preserving the source offsets.
  while (start < end && /\s/.test(content[start] ?? '')) start += 1;
  while (end > start && /\s/.test(content[end - 1] ?? '')) end -= 1;
  if (end <= start) return null;
  const exact = content.slice(start, end);
  if (!exact.trim()) return null;
  const rect = range.getBoundingClientRect();
  return {
    exact,
    prefix: content.slice(Math.max(0, start - 48), start),
    suffix: content.slice(end, Math.min(content.length, end + 48)),
    startUtf16: start,
    endUtf16: end,
    heading: blockHeading(startBlock),
    locator: blockLocator(startBlock),
    rect,
  };
}

export function rangeForOffsets(
  article: HTMLElement | null,
  start: number,
  end: number,
): Range | null {
  if (!article) return null;
  const blocks = Array.from(article.querySelectorAll<HTMLElement>('[data-start][data-end]'));
  const startBlock = blocks.find((block) => start >= blockStart(block) && start <= blockEnd(block));
  const endBlock = blocks.find((block) => end >= blockStart(block) && end <= blockEnd(block));
  if (!startBlock || !endBlock) return null;
  const startNode = startBlock.firstChild;
  const endNode = endBlock.firstChild;
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  try {
    range.setStart(startNode, Math.max(0, start - blockStart(startBlock)));
    range.setEnd(endNode, Math.max(0, end - blockStart(endBlock)));
  } catch {
    return null;
  }
  return range;
}

export function highlightOffsets(article: HTMLElement | null, start: number, end: number): boolean {
  const range = rangeForOffsets(article, start, end);
  if (!range) return false;
  const HighlightCtor = (window as unknown as { Highlight?: typeof Highlight }).Highlight;
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  if (HighlightCtor && registry) {
    registry.set('fold-find', new HighlightCtor(range));
    window.setTimeout(() => registry.delete('fold-find'), 2600);
  }
  const element =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}

export function selectionFromPoint(x: number, y: number): boolean {
  const element = document.elementFromPoint(x, y);
  return Boolean(element?.closest('[data-start]'));
}
