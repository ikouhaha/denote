import { useMemo, useState } from "react";

type Props = {
  id: string;
  label: string;
  value: string;
  values: string[];
  onChange(value: string): void;
};

export function Combobox({ id, label, value, values, onChange }: Props) {
  const [query, setQuery] = useState("");
  const filteredValues = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return values.slice(0, 80);
    }
    return values.filter((item) => item.toLowerCase().includes(normalizedQuery)).slice(0, 80);
  }, [query, values]);
  const listId = `${id}Options`;

  return (
    <label className="combobox-field">
      <span>{label}</span>
      <input
        aria-autocomplete="list"
        aria-controls={listId}
        id={id}
        list={listId}
        onChange={(event) => {
          setQuery(event.target.value);
          onChange(event.target.value);
        }}
        placeholder={label}
        value={value || query}
      />
      <datalist id={listId}>
        <option value="" />
        {filteredValues.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </datalist>
    </label>
  );
}
