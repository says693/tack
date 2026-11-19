import { describe, expect, it } from 'vitest';

import { splitSourceBlocks } from '@/lib/source';

describe('splitSourceBlocks', () => {
  it('keeps exact UTF-16 offsets for Chinese paragraphs', () => {
    const content =
      '青石镇档案室规定：蓝色盒存放待登记条目，\n绿色盒存放已登记条目。\n\n管理员先核对编号。';
    const blocks = splitSourceBlocks(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe('青石镇档案室规定：蓝色盒存放待登记条目，\n绿色盒存放已登记条目。');
    expect(blocks[0].start).toBe(0);
    expect(blocks[0].end).toBe(blocks[0].start + blocks[0].text.length);
    expect(content.slice(blocks[0].start, blocks[0].end)).toBe(blocks[0].text);
    expect(blocks[1].text).toBe('管理员先核对编号。');
    expect(content.slice(blocks[1].start, blocks[1].end)).toBe(blocks[1].text);
  });

  it('tracks the active heading and builds a readable locator', () => {
    const content = '# 材料 A · 青石镇档案室\n\n第一段。\n\n## 登记流程\n\n第二段。';
    const blocks = splitSourceBlocks(content);
    expect(blocks.map((block) => block.isHeading)).toEqual([true, false, true, false]);
    const first = blocks[1];
    const second = blocks[3];
    expect(first.heading).toBe('材料 A · 青石镇档案室');
    expect(second.heading).toBe('登记流程');
    expect(second.locator).toContain('§登记流程');
  });

  it('ignores booking whitespace without moving the anchor', () => {
    const content = '  第一段内容。  \n\n \t \n\n第二段内容。';
    const blocks = splitSourceBlocks(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe('第一段内容。');
    expect(blocks[0].start).toBe(2);
    expect(blocks[1].text).toBe('第二段内容。');
    expect(content.slice(blocks[1].start, blocks[1].end)).toBe(blocks[1].text);
  });

  it('does not merge a heading with the paragraph below it', () => {
    const content = '## 每日上限\n每日最多处理十个新条目。';
    const blocks = splitSourceBlocks(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ text: '每日上限', isHeading: true, heading: '每日上限' });
    expect(blocks[1]).toMatchObject({ text: '每日最多处理十个新条目。', isHeading: false });
  });

  it('returns no blocks for whitespace-only content', () => {
    expect(splitSourceBlocks(' \n\n\t\n ')).toEqual([]);
  });
});
