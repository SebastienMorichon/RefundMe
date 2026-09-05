import type { Metadata } from "next";
import { LegalDocument, PublicPage } from "../../components/public-page";

export const metadata: Metadata = {
  title: "Offre payante bientôt disponible",
};

export default function SalesTermsPage() {
  const sections = [
    {
      id: "indisponible",
      title: "1. Offre non commercialisée",
      content: (
        <>
          <p>
            Lydoc ne commercialise actuellement aucune prestation payante. Aucun
            paiement, abonnement, devis postal ou commande d’impression ne peut
            être réalisé sur la plateforme.
          </p>
          <p>
            Les informations relatives à une future prise en charge de
            l’impression et de l’envoi sont communiquées à titre de présentation
            uniquement. Elles ne constituent ni une offre ferme ni un engagement
            contractuel.
          </p>
        </>
      ),
    },
    {
      id: "gratuit",
      title: "2. Service disponible",
      content: (
        <p>
          Le service accessible est régi par les conditions générales
          d’utilisation. Il permet gratuitement de créer un compte, d’analyser
          une facture, de constituer un dossier et de le télécharger afin de
          l’imprimer et de l’envoyer soi-même.
        </p>
      ),
    },
    {
      id: "future",
      title: "3. Conditions de la future offre",
      content: (
        <>
          <p>
            Avant toute ouverture commerciale, Lydoc publiera des conditions de
            vente complètes précisant notamment l’identité du prestataire, les
            prix TTC, les délais, la validation finale, le mandat d’expédition,
            la rétractation, les remboursements, les réclamations et le
            médiateur de la consommation.
          </p>
          <p>
            Ces conditions devront être acceptées expressément avant toute
            commande. La présentation actuelle ne vaut pas acceptation
            anticipée.
          </p>
        </>
      ),
    },
    {
      id: "contact",
      title: "4. Contact",
      content: (
        <p>
          Pour toute question sur le service actuel ou la future offre, écrivez
          à contact.lydoc@gmail.com.
        </p>
      ),
    },
  ];

  return (
    <PublicPage
      eyebrow="Prochaine étape"
      title="L’envoi par Lydoc arrive bientôt."
      description="La formule payante est volontairement désactivée pendant la phase de lancement."
    >
      <LegalDocument
        updatedAt="2 août 2026 - aucune offre payante active"
        sections={sections}
      />
    </PublicPage>
  );
}
