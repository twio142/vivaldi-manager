import type { ComponentChildren } from "preact";

/** A row's icon that turns into a close button while the row is hovered. */
export function IconClose({ label, onClose, children }: { label: string; onClose: () => void; children: ComponentChildren }) {
  return (
    <span class="icon-close">
      {children}
      <button
        class="close"
        tabIndex={-1}
        title={label}
        aria-label={label}
        // Never takes focus, so keys keep going to the list.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        {/* Drawn, not a "×" glyph: the glyph sits off-center in most fonts. */}
        <svg viewBox="0 0 8 8" aria-hidden="true">
          <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </span>
  );
}
