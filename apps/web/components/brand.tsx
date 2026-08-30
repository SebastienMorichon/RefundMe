export function Brand({
  inverse = false,
  compact = false,
}: {
  inverse?: boolean;
  compact?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Lydoc">
      <span
        className={`grid h-8 w-8 place-items-center rounded-md ${inverse ? "bg-white text-[#087a55]" : "bg-[#e8f7f0] text-[#087a55]"}`}
      >
        <svg viewBox="0 0 64 64" className="h-6 w-6" fill="none" aria-hidden="true">
          <path fill="currentColor" d="M13 6h25l12 12v8H39V17H24v21l7 7 15-15h12L31 57 13 39V6Z" />
          <path fill={inverse ? "#D9F1E6" : "#BFE5D3"} d="M38 6v12h12L38 6Z" />
        </svg>
      </span>
      {compact ? null : (
        <span
          className={`text-[17px] font-extrabold ${inverse ? "text-white" : "text-[#17211d]"}`}
        >
          Lydoc
        </span>
      )}
    </span>
  );
}
