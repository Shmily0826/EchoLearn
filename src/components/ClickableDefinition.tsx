import { useMemo } from 'react';

interface ClickableDefinitionProps {
  text: string;
  onWordClick: (word: string) => void;
  className?: string;
}

/** Common function words that are unlikely to need lookup */
const SKIP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
  'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each',
  'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because',
  'if', 'when', 'where', 'how', 'what', 'which', 'who', 'whom', 'this',
  'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they', 'them',
  'his', 'her', 'their', 'my', 'your', 'our', 'i', 'me', 'we', 'us',
  'about', 'up', 'out', 'then', 'also', 'here', 'there',
]);

/**
 * Renders definition text with each meaningful word as a clickable element.
 * Common function words (the, a, is, etc.) are rendered as plain text to reduce noise.
 */
const ClickableDefinition: React.FC<ClickableDefinitionProps> = ({
  text,
  onWordClick,
  className = '',
}) => {
  const tokens = useMemo(() => {
    return text.match(/[\w']+|[^\w\s]+|\s+/g) || [];
  }, [text]);

  return (
    <span className={className}>
      {tokens.map((token, i) => {
        // Whitespace
        if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
        // Punctuation
        if (/^[^\w']+$/.test(token)) return <span key={i}>{token}</span>;
        // Skip common function words
        const lower = token.toLowerCase().replace(/'/g, '');
        if (SKIP_WORDS.has(lower)) return <span key={i}>{token}</span>;
        // Clickable word
        return (
          <span
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onWordClick(token);
            }}
            className="text-indigo-600 dark:text-indigo-400 underline decoration-indigo-300 dark:decoration-indigo-600 decoration-1 underline-offset-2 cursor-pointer hover:text-indigo-800 dark:hover:text-indigo-200 hover:decoration-indigo-500 dark:hover:decoration-indigo-400 transition-colors"
          >
            {token}
          </span>
        );
      })}
    </span>
  );
};

export default ClickableDefinition;
