import { Fragment, type ReactNode } from 'react';

function renderInlineFormatting(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-stone-900 dark:text-stone-50">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={idx}>{part}</Fragment>;
  });
}

export function RichTextBlock({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (keyPrefix: string) => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`${keyPrefix}-ul`} className="my-2 space-y-1.5 pl-4 list-disc">
        {listItems.map((item, i) => (
          <li key={i} className="leading-relaxed">
            {renderInlineFormatting(item)}
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) {
      flushList(`b-${idx}`);
      return;
    }

    if (/^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      listItems.push(line.replace(/^([-*•]|\d+\.)\s+/, ''));
      return;
    }

    flushList(`b-${idx}`);

    if (/^#{1,3}\s+/.test(line)) {
      const headingText = line.replace(/^#{1,3}\s+/, '');
      blocks.push(
        <h4
          key={`h-${idx}`}
          className="mt-3 mb-1 font-serif text-sm font-bold text-stone-900 dark:text-stone-100"
        >
          {renderInlineFormatting(headingText)}
        </h4>
      );
      return;
    }

    blocks.push(
      <p key={`p-${idx}`} className="my-1.5 leading-relaxed">
        {renderInlineFormatting(line)}
      </p>
    );
  });

  flushList('end');

  return <div className="text-xs sm:text-[13px] text-stone-700 dark:text-stone-300">{blocks}</div>;
}
