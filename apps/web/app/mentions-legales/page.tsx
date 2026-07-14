import type { Metadata } from "next";
import { LegalDocument, PublicPage } from "../../components/public-page";

export const metadata: Metadata = { title: "Mentions légales" };

export default function LegalNoticePage() {
  const sections = [
    { id: "editeur", title: "Éditeur du site", content: <><p>Lydoc - informations relatives à la forme juridique, au capital, au siège social et à l’immatriculation à compléter avant publication commerciale.</p><p>Contact : contact@lydoc.fr</p></> },
    { id: "direction", title: "Direction de la publication", content: <><p>L’identité du directeur ou de la directrice de la publication sera indiquée après constitution définitive de la société.</p></> },
    { id: "hebergement", title: "Hébergement", content: <><p>Les coordonnées complètes de l’hébergeur de production seront ajoutées avant la mise en ligne publique.</p></> },
    { id: "propriete", title: "Propriété intellectuelle", content: <><p>La marque, les textes, la structure, l’interface et les éléments graphiques du site sont protégés. Toute reproduction non autorisée est interdite, sauf exceptions prévues par la loi.</p></> },
    { id: "responsabilite", title: "Limitation de responsabilité", content: <><p>Les informations présentées décrivent un service d’assistance documentaire. Elles ne constituent ni un conseil juridique individualisé ni une garantie de remboursement.</p></> },
    { id: "contact", title: "Nous contacter", content: <><p>Pour signaler un contenu ou poser une question sur le site, écrivez à contact@lydoc.fr ou utilisez le formulaire de contact.</p></> },
  ];
  return <PublicPage eyebrow="Informations légales" title="Mentions légales" description="Les informations relatives à l’éditeur et au fonctionnement du site."><LegalDocument updatedAt="10 juillet 2026 - à compléter avant publication" sections={sections} /></PublicPage>;
}
