import type { Metadata } from "next";
import { Clock3, Mail, MessageSquareText } from "lucide-react";
import { ContactForm } from "../../components/contact-form";
import { PublicPage } from "../../components/public-page";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <PublicPage eyebrow="Nous contacter" title="Une question ? Écrivez-nous simplement." description="Un dossier, un document ou une question sur Lydoc : choisissez le sujet et donnez-nous les éléments utiles.">
      <section className="page-container grid gap-12 py-14 lg:grid-cols-[0.55fr_1fr] lg:py-20">
        <aside>
          <h2 className="text-xl font-extrabold text-[#102544]">Nous sommes à votre écoute</h2>
          <div className="mt-7 grid gap-6 text-sm">
            <div className="flex gap-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#e8efff] text-[#2457f5]"><Mail size={19} /></span><div><p className="font-extrabold text-[#26334f]">Par e-mail</p><p className="mt-1 text-[#667189]">contact@lydoc.fr</p></div></div>
            <div className="flex gap-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#e8f7f0] text-[#16875b]"><Clock3 size={19} /></span><div><p className="font-extrabold text-[#26334f]">Délai de réponse</p><p className="mt-1 text-[#667189]">Sous 2 jours ouvrés</p></div></div>
            <div className="flex gap-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#fff4e7] text-[#a95d12]"><MessageSquareText size={19} /></span><div><p className="font-extrabold text-[#26334f]">Besoin d’une réponse rapide ?</p><p className="mt-1 leading-6 text-[#667189]">La FAQ couvre les questions les plus fréquentes sur les documents et les remboursements.</p><a href="/faq" className="mt-2 inline-block font-extrabold text-[#2457f5]">Consulter la FAQ</a></div></div>
          </div>
        </aside>
        <div className="border-t border-[#dce3ed] pt-8 lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0"><ContactForm /></div>
      </section>
    </PublicPage>
  );
}
