import type { ReactNode, SVGProps } from "react";

export type LydocIcon = (props: IconProps) => ReactNode;
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function IconFrame({ size = 24, children, ...props }: IconProps) {
  return <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden="true" {...props}>{children}</svg>;
}

const stroke = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function AnalysisIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M8 4.5h11l5 5V27H8z" fill="#DDF3E8" {...stroke}/><path d="M19 4.5v5h5M11.5 14h8M11.5 18h5" {...stroke}/><path d="M24.5 18.5v6M21.5 21.5h6" stroke="#E76F51" strokeWidth="2" strokeLinecap="round"/></IconFrame>;
}

export function CaseFolderIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M4.5 9.5h9l2-3h5.5c1.4 0 2.5 1.1 2.5 2.5v2.5h4v12c0 1.7-1.3 3-3 3h-17c-1.7 0-3-1.3-3-3z" fill="#DDF3E8" {...stroke}/><path d="M4.5 11.5h23M10 17h8M10 21h11" {...stroke}/><path d="m22 17 1.7 1.7 3.3-3.5" stroke="#E76F51" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></IconFrame>;
}

export function ReadyCaseIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M7 5h13l5 5v17H7z" fill="#DDF3E8" {...stroke}/><path d="M20 5v5h5M11 15h10M11 19h6" {...stroke}/><circle cx="21.5" cy="22.5" r="5" fill="#087A55"/><path d="m19.3 22.5 1.5 1.5 2.8-3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></IconFrame>;
}

export function SendCaseIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M4.5 10.5h23v15h-23z" fill="#DDF3E8" {...stroke}/><path d="m5 11 11 8 11-8M5 25l8-8M27 25l-8-8" {...stroke}/><path d="M8 6h11M5 3h9" stroke="#E76F51" strokeWidth="1.8" strokeLinecap="round"/></IconFrame>;
}

export function RefundIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M5 9h22v15H5z" fill="#DDF3E8" {...stroke}/><path d="M8 12h16M9 20h5" {...stroke}/><circle cx="21" cy="18" r="4" fill="#087A55"/><path d="M19.7 18h2.6M21 16.7v2.6" stroke="white" strokeWidth="1.5" strokeLinecap="round"/><path d="m6 6 3-2 3 2" stroke="#E76F51" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></IconFrame>;
}

export function ArchiveIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M6 9h20v18H6z" fill="#DDF3E8" {...stroke}/><path d="M4.5 5h23v5h-23zM12 15h8" {...stroke}/><path d="M22 19.5v5M19.5 22h5" stroke="#E76F51" strokeWidth="2" strokeLinecap="round"/></IconFrame>;
}

export function DetectionIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M8 5h16v22H8z" fill="#DDF3E8" {...stroke}/><path d="M11 12h10M11 16h7" {...stroke}/><path d="m24 18 1.2 2.8L28 22l-2.8 1.2L24 26l-1.2-2.8L20 22l2.8-1.2z" fill="#E76F51"/></IconFrame>;
}

export function ProcessingIcon(props: IconProps) {
  return <IconFrame {...props}><circle cx="16" cy="16" r="10" fill="#DDF3E8" {...stroke}/><path d="M16 10v6l4 2M16 3v3M16 26v3" {...stroke}/><circle cx="16" cy="16" r="2" fill="#E76F51"/></IconFrame>;
}

export function ProgressIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M6 26V14l7 4V9l7 4V5h6v21z" fill="#DDF3E8" {...stroke}/><path d="m10 12 3-3 3 2 5-5" stroke="#E76F51" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></IconFrame>;
}
