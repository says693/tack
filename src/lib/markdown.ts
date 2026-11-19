import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: true,
  typographer: true,
});

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'blockquote',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
];

export function renderMarkdown(text: string): string {
  const rendered = md.render(text);
  return DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [],
    FORBID_ATTR: ['href', 'src', 'style', 'onerror', 'onclick'],
  });
}

export function renderInlineMarkdown(text: string): string {
  const rendered = md.renderInline(text);
  return DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [],
    FORBID_ATTR: ['href', 'src', 'style', 'onerror', 'onclick'],
  });
}

export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-]+/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
