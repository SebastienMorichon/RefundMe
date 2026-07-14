import type { Metadata } from "next";
import { LegalDocument, PublicPage } from "../../components/public-page";

export const metadata: Metadata = { title: "Politique de confidentialité" };

export default function PrivacyPage() {
  const sections = [
    { id: "donnees", title: "1. Données utilisées", content: <><p>Lydoc traite les informations du compte, les documents déposés, les résultats d’analyse et les données nécessaires au suivi des dossiers.</p><p>Le service est conçu pour éviter la collecte prématurée de données sensibles : aucun RIB ni document d’identité n’est demandé lors de la simple création du compte.</p></> },
    { id: "finalites", title: "2. Pourquoi ces données sont utilisées", content: <><p>Les données servent à authentifier l’utilisateur, analyser ses documents, identifier un règlement applicable, préparer le dossier demandé et assurer son suivi.</p></> },
    { id: "securite", title: "3. Protection des documents", content: <><p>Les documents sont stockés sous forme chiffrée et liés au compte qui les a déposés. Des contrôles d’accès limitent leur consultation aux opérations nécessaires au service.</p></> },
    { id: "duree", title: "4. Durées de conservation", content: <><p>Les durées définitives seront adaptées à la finalité de chaque donnée et aux obligations légales applicables. Elles seront précisées avant la mise en production commerciale.</p></> },
    { id: "prestataires", title: "5. Prestataires techniques", content: <><p>Certains traitements peuvent faire appel à des prestataires d’hébergement, de paiement et d’analyse documentaire. Lydoc sélectionne des prestataires offrant des garanties adaptées et encadre leur accès aux données.</p></> },
    { id: "droits", title: "6. Vos droits", content: <><p>Vous pouvez demander l’accès, la rectification, l’effacement ou la limitation de vos données, ainsi que vous opposer à certains traitements lorsque la réglementation le permet.</p><p>Les demandes peuvent être adressées à contact@lydoc.fr. L’identité du demandeur pourra être vérifiée lorsqu’elle est nécessaire pour protéger le compte.</p></> },
    { id: "contact", title: "7. Contact", content: <><p>Pour toute question sur la confidentialité : contact@lydoc.fr. Les coordonnées du responsable de traitement et, le cas échéant, du délégué à la protection des données seront complétées avant lancement.</p></> },
  ];
  return <PublicPage eyebrow="Protection des données" title="Politique de confidentialité" description="Ce que Lydoc utilise, pourquoi, et les choix dont vous disposez."><LegalDocument updatedAt="10 juillet 2026 - version de travail" sections={sections} /></PublicPage>;
}
