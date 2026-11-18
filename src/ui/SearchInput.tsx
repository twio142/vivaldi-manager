import { useEffect, useRef } from "preact/hooks";

/** Takes keyboard focus while `active`, gives it back to the list otherwise. */
export function SearchInput({
  value,
  active,
  onInput,
  onFocus,
}: {
  value: string;
  active: boolean;
  onInput: (value: string) => void;
  onFocus?: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (active) ref.current?.focus();
    else ref.current?.blur();
  }, [active]);
  return (
    <input
      ref={ref}
      class="search"
      type="text"
      placeholder="Search"
      spellcheck={false}
      value={value}
      onInput={(e) => onInput(e.currentTarget.value)}
      onFocus={onFocus}
    />
  );
}
