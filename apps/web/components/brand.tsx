import { ScanLine } from "lucide-react";

export function Brand({ inverse = false, compact = false }: { inverse?: boolean; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Lydoc">
      <span
        className={`grid h-8 w-8 place-items-center rounded-md ${inverse ? "bg-white text-[#2457f5]" : "bg-[#2457f5] text-white"}`}
      >
        <ScanLine size={18} strokeWidth={2.4} aria-hidden="true" />
      </span>
      {compact ? null : (
        <span className={`text-[17px] font-extrabold ${inverse ? "text-white" : "text-[#102544]"}`}>
          Lydoc
        </span>
      )}
    </span>
  );
}
