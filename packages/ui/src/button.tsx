import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary";
};

export function Button({ children, variant = "primary", ...props }: ButtonProps) {
  const className =
    variant === "primary"
      ? "rounded-md bg-[#5147f5] px-4 py-2 text-sm font-semibold text-white shadow-sm"
      : "rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900";

  return (
    <button {...props} className={[className, props.className].filter(Boolean).join(" ")}>
      {children}
    </button>
  );
}

