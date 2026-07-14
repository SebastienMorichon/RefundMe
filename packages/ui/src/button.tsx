import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({ children, variant = "primary", ...props }: ButtonProps) {
  const baseClassName =
    "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-bold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50";
  const variantClassName =
    variant === "primary"
      ? "bg-[#2457f5] text-white shadow-sm hover:bg-[#1947d8]"
      : variant === "secondary"
        ? "border border-[#c8d2df] bg-white text-[#111b35] hover:bg-[#f3f6fa]"
        : "bg-transparent text-[#34415d] hover:bg-[#edf2f8]";

  return (
    <button
      {...props}
      className={[baseClassName, variantClassName, props.className].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}
