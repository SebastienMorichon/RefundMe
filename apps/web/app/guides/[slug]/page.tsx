import type { Metadata } from "next";
import { ArrowRight, Clock3 } from "lucide-react";
import { notFound } from "next/navigation";
import { PublicPage } from "../../../components/public-page";
import { findGuide, guides } from "../../../lib/guides";

type GuidePageProps = Readonly<{ params: Promise<{ slug: string }> }>;

export function generateStaticParams() {
  return guides.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: GuidePageProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = findGuide(slug);
  if (!guide) return {};
  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical: `/guides/${guide.slug}` },
    openGraph: {
      type: "article",
      title: guide.title,
      description: guide.description,
      url: `/guides/${guide.slug}`,
    },
  };
}

export default async function GuidePage({ params }: GuidePageProps) {
  const { slug } = await params;
  const guide = findGuide(slug);
  if (!guide) notFound();

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "https://lydoc.fr";
  const articleStructuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    description: guide.description,
    dateModified: "2026-09-13",
    datePublished: "2026-09-13",
    inLanguage: "fr-FR",
    mainEntityOfPage: `${origin}/guides/${guide.slug}`,
    author: { "@type": "Organization", name: "Lydoc" },
    publisher: { "@type": "Organization", name: "Lydoc" },
  };

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(articleStructuredData).replace(
            /</g,
            "\\u003c",
          ),
        }}
      />
      <PublicPage
        eyebrow={guide.eyebrow}
        title={guide.title}
        description={guide.description}
      >
        <article className="page-container grid gap-10 py-14 lg:grid-cols-[1fr_280px] lg:py-20">
          <div className="max-w-3xl">
            <div className="mb-10 flex flex-wrap items-center gap-4 border-b border-[#dce5e0] pb-6 text-xs font-semibold text-[#6b768c]">
              <span className="inline-flex items-center gap-2">
                <Clock3 size={15} /> {guide.readingTime} de lecture
              </span>
              <span>Mis à jour le {guide.updatedAt}</span>
            </div>
            <div className="grid gap-12">
              {guide.sections.map((section) => (
                <section key={section.title}>
                  <h2 className="text-2xl font-extrabold leading-tight text-[#17211d] sm:text-3xl">
                    {section.title}
                  </h2>
                  <div className="mt-5 grid gap-4 text-base leading-8 text-[#526058]">
                    {section.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                    {section.bullets ? (
                      <ul className="grid gap-3 border-l-4 border-[#b9dbc9] bg-[#f3f8f5] px-6 py-5 text-sm leading-6">
                        {section.bullets.map((item) => (
                          <li key={item}>• {item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </section>
              ))}
            </div>
          </div>
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <div className="rounded-[18px] bg-[#17211d] p-6 text-white">
              <p className="text-xs font-extrabold uppercase text-[#82a3ff]">
                Passer à l’action
              </p>
              <h2 className="mt-3 text-xl font-extrabold">
                Préparez votre dossier gratuitement.
              </h2>
              <p className="mt-3 text-sm leading-6 text-[#c2cede]">
                Lydoc applique le règlement sélectionné aux informations que
                vous confirmez. Le remboursement reste décidé par
                l’organisateur.
              </p>
              <a
                href="/inscription"
                className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-extrabold text-[#17211d]"
              >
                Créer mon dossier <ArrowRight size={16} />
              </a>
            </div>
          </aside>
        </article>
      </PublicPage>
    </div>
  );
}
