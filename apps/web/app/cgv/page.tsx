import type { Metadata } from "next";
import { LegalDocument, PublicPage } from "../../components/public-page";

export const metadata: Metadata = { title: "Conditions générales de vente" };

export default function TermsPage() {
  const sections = [
    { id: "objet", title: "1. Objet du service", content: <><p>Lydoc propose un service d’analyse documentaire et d’assistance à la préparation de dossiers de remboursement. Le service identifie des conditions potentiellement applicables à partir des documents transmis par l’utilisateur.</p><p>Lydoc n’est ni l’organisateur du jeu ni l’organisme payeur. Il ne décide pas de l’acceptation ou du refus d’une demande.</p></> },
    { id: "compte", title: "2. Création du compte", content: <><p>L’utilisateur crée un compte avec une adresse e-mail valide et un mot de passe. Il est responsable de la confidentialité de ses accès et de l’exactitude des informations transmises.</p><p>Le RIB et la pièce d’identité ne sont pas exigés lors de l’inscription. Ils peuvent être demandés ultérieurement lorsqu’ils sont nécessaires au dossier choisi.</p></> },
    { id: "analyse", title: "3. Analyse et estimation", content: <><p>Les résultats affichés sont des estimations établies à partir de la lisibilité du document, des informations détectées et du règlement disponible. Ils doivent être vérifiés avant l’envoi définitif.</p><p>Aucune estimation ne constitue une garantie de remboursement.</p></> },
    { id: "prix", title: "4. Prix et paiement", content: <><p>L’analyse initiale est proposée sans paiement. Le prix applicable à la préparation d’un dossier est communiqué clairement avant la validation par l’utilisateur.</p><p>Le service ne comporte pas d’abonnement sauf accord exprès présenté séparément. Les modalités définitives de paiement et de rétractation devront être validées avant la mise en production.</p></> },
    { id: "obligations", title: "5. Obligations de l’utilisateur", content: <><p>L’utilisateur transmet uniquement des documents lui appartenant ou qu’il est autorisé à utiliser. Il s’engage à ne pas altérer les justificatifs et à vérifier les informations de son dossier avant validation.</p></> },
    { id: "responsabilite", title: "6. Responsabilité", content: <><p>Lydoc met en œuvre des moyens raisonnables pour préparer un dossier cohérent. La décision finale, les délais de traitement et le versement relèvent exclusivement de l’organisateur ou de son mandataire.</p></> },
    { id: "contact", title: "7. Contact et réclamations", content: <><p>Toute question relative au service peut être adressée à contact@lydoc.fr. Les coordonnées légales et les modalités de médiation seront complétées avant l’ouverture commerciale.</p></> },
  ];
  return <PublicPage eyebrow="Informations contractuelles" title="Conditions générales de vente" description="Le cadre d’utilisation du service Lydoc et les responsabilités de chacun."><LegalDocument updatedAt="10 juillet 2026 - version de travail" sections={sections} /></PublicPage>;
}
