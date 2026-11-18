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
        ×
      </button>
    </span>
  );
}
