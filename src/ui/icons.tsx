// Line icons on a 28-unit grid. The viewBox is cropped to the drawn area so they fill their box.

const stroke = { stroke: "currentColor", "stroke-width": 1.2, "stroke-linecap": "round", "stroke-linejoin": "round" } as const;

export function TabsIcon() {
  return (
    <svg class="icon" viewBox="5 5 18 18" fill="none" aria-hidden="true">
      <path d="M10.0027 7C9.98596 6.75234 10.0461 6.56104 10.2096 6.4C10.6157 6 11.443 6 13.0975 6H14.9025C16.557 6 17.3842 6 17.7904 6.4C17.9538 6.56104 18.014 6.75234 17.9973 7" {...stroke} />
      <path d="M8 10C8.03243 9.82691 8.10695 9.67729 8.23115 9.54287C8.7328 9 9.77266 9 11.8524 9H16.1477C18.2273 9 19.2672 9 19.7688 9.54287C19.893 9.67729 19.9676 9.82691 20 10" {...stroke} />
      <path d="M7.63586 16.265L8.19499 18.1495C8.8915 20.497 9.48678 21 11.8302 21H16.1698C18.5132 21 19.1085 20.497 19.805 18.1495L20.3642 16.265C20.9425 14.3157 21.2317 13.341 20.7745 12.6705C20.3174 12 19.3636 12 17.456 12H10.544C8.63645 12 7.68266 12 7.22546 12.6705C6.76828 13.341 7.05747 14.3157 7.63586 16.265Z" fill="currentColor" fill-opacity={0.1} {...stroke} />
    </svg>
  );
}

export function ReadingListIcon() {
  return (
    <svg class="icon" viewBox="5 5 18 18" fill="none" aria-hidden="true">
      <path d="M21 18V12.7516C21 9.56889 21 7.97752 20.1041 6.98875C19.2082 6 17.7662 6 14.8824 6H14.1176C11.2338 6 9.79182 6 8.89591 6.98875C8 7.97752 8 9.56889 8 12.7516V18" fill="currentColor" fill-opacity={0.1} />
      <path d="M21 18V12.7516C21 9.56889 21 7.97752 20.1041 6.98875C19.2082 6 17.7662 6 14.8824 6H14.1176C11.2338 6 9.79182 6 8.89591 6.98875C8 7.97752 8 9.56889 8 12.7516V18" {...stroke} />
      <path d="M8 19L8 18" {...stroke} />
      <path d="M21 18H9.91176C8.85593 18 8 18.8954 8 20C8 21.1046 8.85593 22 9.91176 22H21" {...stroke} />
      <path d="M21 22C19.8954 22 19 21.1046 19 20C19 18.8954 19.8954 18 21 18" {...stroke} />
      <path d="M17 10H12" {...stroke} />
      <path d="M14 13H12" {...stroke} />
    </svg>
  );
}

export function SortIcon() {
  return (
    <svg class="icon sort" viewBox="8.5 5 11 18" fill="none" aria-hidden="true">
      {/* Stroked in the fill's color only to round the corners; opacity on the whole shape keeps it one flat tone. */}
      <path d="M9.6 12.2L14 17.8L18.4 12.2Z" fill="currentColor" opacity={0.5} {...stroke} />
    </svg>
  );
}
