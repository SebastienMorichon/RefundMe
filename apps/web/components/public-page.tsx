import type { ReactNode } from "react";
import { PublicFooter } from "./public-footer";
import { PublicHeader } from "./public-header";

export function PublicPage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-[#111b35]">
      <PublicHeader />
      <main>
        <section className="border-b border-[#dce3ed] bg-[#f3f6fa]">
          <div className="page-container py-16 sm:py-20">
            <p className="eyebrow">{eyebrow}</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-extrabold leading-tight text-[#102544] sm:text-5xl">{title}</h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[#5d6881] sm:text-lg">{description}</p>
          </div>
        </section>
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}

export function LegalDocument({
  updatedAt,
  sections,
}: {
  updatedAt: string;
  sections: Array<{ id: string; title: string; content: ReactNode }>;
}) {
  return (
    <section className="page-container grid gap-10 py-14 lg:grid-cols-[240px_1fr] lg:py-20">
      <aside className="lg:sticky lg:top-28 lg:self-start">
        <p className="text-xs font-extrabold uppercase text-[#7a8499]">Dernière mise à jour</p>
        <p className="mt-2 text-sm font-bold text-[#102544]">{updatedAt}</p>
        <nav className="mt-7 hidden border-l border-[#dce3ed] pl-4 lg:grid lg:gap-3" aria-label="Sommaire">
          {sections.map((section) => <a key={section.id} href={`#${section.id}`} className="text-sm font-semibold text-[#667189] hover:text-[#2457f5]">{section.title}</a>)}
        </nav>
      </aside>
      <article className="max-w-3xl divide-y divide-[#dce3ed]">
        {sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-28 py-8 first:pt-0">
            <h2 className="text-xl font-extrabold text-[#102544] sm:text-2xl">{section.title}</h2>
            <div className="mt-4 grid gap-4 text-sm leading-7 text-[#536078]">{section.content}</div>
          </section>
        ))}
      </article>
    </section>
  );
}
