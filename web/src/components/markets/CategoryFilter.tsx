'use client';

interface CategoryFilterProps {
  categories: string[];
  selected: string;
  onSelect: (category: string) => void;
}

function capitalize(label: string): string {
  if (label.length === 0) return label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Horizontal category filter chips for the Markets catalog (FR-MKT-2).
 * "All" + the distinct categories present in the loaded markets.
 */
export default function CategoryFilter({
  categories,
  selected,
  onSelect,
}: CategoryFilterProps) {
  const chips = ['all', ...categories];

  return (
    <div
      className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide"
      data-testid="markets-category-filter"
    >
      {chips.map((cat) => {
        const active = selected === cat;
        return (
          <button
            key={cat}
            type="button"
            onClick={() => onSelect(cat)}
            data-testid={`markets-filter-chip-${cat}`}
            className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap
              ${
                active
                  ? 'bg-indigo-600 text-white'
                  : 'bg-glass text-gray-400 hover:text-white hover:bg-white/10'
              }`}
          >
            {cat === 'all' ? 'All' : capitalize(cat)}
          </button>
        );
      })}
    </div>
  );
}
