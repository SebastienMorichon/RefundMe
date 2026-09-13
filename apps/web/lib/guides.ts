export type GuideSection = Readonly<{
  title: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
}>;

export type Guide = Readonly<{
  slug: string;
  title: string;
  description: string;
  eyebrow: string;
  readingTime: string;
  updatedAt: string;
  sections: readonly GuideSection[];
}>;

export const guides: readonly Guide[] = [
  {
    slug: "remboursement-sms-surtaxe-jeu-concours",
    title:
      "Comment demander le remboursement d’un SMS surtaxé de jeu-concours ?",
    description:
      "Les étapes pour vérifier le règlement, retrouver les frais sur votre facture et préparer une demande complète sans oublier le délai.",
    eyebrow: "Guide de départ",
    readingTime: "5 min",
    updatedAt: "13 septembre 2026",
    sections: [
      {
        title: "Commencez toujours par le règlement du jeu",
        paragraphs: [
          "La possibilité de demander un remboursement, le délai, l’adresse d’envoi et les justificatifs dépendent du règlement applicable au jeu auquel vous avez participé. Une procédure valable pour un jeu ne doit pas être réutilisée automatiquement pour un autre.",
          "Retrouvez le nom exact du jeu, sa période de participation et la version du règlement correspondant à votre participation.",
        ],
      },
      {
        title: "Réunissez les informations utiles",
        paragraphs: [
          "Préparez la facture mobile détaillée sur laquelle apparaissent les SMS concernés. Selon le règlement, d’autres pièces peuvent être demandées.",
        ],
        bullets: [
          "la date et l’heure de chaque participation ;",
          "le numéro court ou le libellé du SMS+ ;",
          "le montant facturé ;",
          "le nom du jeu ou de l’émission ;",
          "les justificatifs expressément prévus par le règlement.",
        ],
      },
      {
        title: "Préparez puis relisez la demande",
        paragraphs: [
          "La lettre doit reprendre les informations demandées et être accompagnée uniquement des pièces nécessaires. Vérifiez l’adresse, le mode d’envoi et la date limite avant l’expédition.",
          "Lydoc vous aide à appliquer le règlement sélectionné et à produire un dossier prêt à envoyer. La décision finale appartient toujours à l’organisateur.",
        ],
      },
    ],
  },
  {
    slug: "justificatifs-remboursement-sms",
    title: "Quels justificatifs joindre pour un remboursement de SMS+ ?",
    description:
      "Facture mobile, identité, RIB ou justificatif de domicile : distinguez les pièces courantes de celles réellement exigées par le règlement.",
    eyebrow: "Pièces du dossier",
    readingTime: "4 min",
    updatedAt: "13 septembre 2026",
    sections: [
      {
        title: "La facture mobile détaillée",
        paragraphs: [
          "La facture détaillée est généralement le point de départ : elle permet d’identifier la ligne, les participations et les montants facturés. Utilisez un document complet et lisible, correspondant à la bonne période.",
        ],
      },
      {
        title: "Les pièces qui peuvent être demandées",
        paragraphs: [
          "La liste exacte varie. Ne transmettez pas spontanément davantage de données personnelles que nécessaire.",
        ],
        bullets: [
          "une copie d’une pièce d’identité ;",
          "un relevé d’identité bancaire ;",
          "un justificatif de domicile ;",
          "une preuve d’affranchissement ;",
          "des informations relatives à une carte prépayée.",
        ],
      },
      {
        title: "Contrôlez la cohérence des titulaires",
        paragraphs: [
          "Certains règlements demandent que le titulaire de la ligne, du compte bancaire ou de l’adresse corresponde au demandeur. Vérifiez ce point dans le texte applicable avant de constituer le dossier.",
        ],
      },
    ],
  },
  {
    slug: "trouver-sms-surtaxes-facture-mobile",
    title: "Comment retrouver les SMS surtaxés sur une facture mobile ?",
    description:
      "Repérez les SMS+, numéros courts et achats multimédias dans une facture détaillée avant de préparer votre demande.",
    eyebrow: "Lire sa facture",
    readingTime: "4 min",
    updatedAt: "13 septembre 2026",
    sections: [
      {
        title: "Téléchargez la facture détaillée",
        paragraphs: [
          "Depuis l’espace client de votre opérateur, choisissez la facture correspondant au mois de participation. Si plusieurs factures sont proposées, recherchez la version détaillée plutôt que le simple récapitulatif.",
        ],
      },
      {
        title: "Cherchez les rubriques SMS+ ou services tiers",
        paragraphs: [
          "Le vocabulaire dépend de l’opérateur. Les frais peuvent apparaître dans une rubrique dédiée aux SMS surtaxés, aux numéros courts, aux services tiers ou aux achats multimédias.",
        ],
        bullets: [
          "comparez la date avec celle de votre participation ;",
          "notez le numéro court ou le libellé ;",
          "relevez séparément le nombre de SMS et le total facturé ;",
          "conservez le PDF original sans le modifier.",
        ],
      },
      {
        title: "Ne confondez pas tous les frais",
        paragraphs: [
          "Une facture peut contenir d’autres achats ou abonnements. La demande doit concerner les participations visées par le règlement sélectionné, pas l’ensemble des services facturés sur la ligne.",
        ],
      },
    ],
  },
  {
    slug: "delai-demande-remboursement-jeu-concours",
    title: "Quel délai pour demander le remboursement d’un jeu-concours ?",
    description:
      "Apprenez où trouver la date limite applicable et comment éviter qu’un dossier soit envoyé hors délai.",
    eyebrow: "Délais à respecter",
    readingTime: "3 min",
    updatedAt: "13 septembre 2026",
    sections: [
      {
        title: "Il n’existe pas un délai unique pour tous les jeux",
        paragraphs: [
          "La date limite est fixée par le règlement concerné. Elle peut être calculée à partir de la participation, de la fin d’une session ou de la clôture du jeu. Fiez-vous au texte correspondant à votre participation.",
        ],
      },
      {
        title: "Repérez le point de départ et la preuve retenue",
        paragraphs: [
          "Vérifiez si le règlement se réfère à la date d’envoi, au cachet de la poste ou à la date de réception. Cette distinction peut être déterminante lorsque l’échéance approche.",
        ],
      },
      {
        title: "N’attendez pas la dernière semaine",
        paragraphs: [
          "Téléchargez votre facture dès qu’elle est disponible, rassemblez les pièces et prévoyez le délai postal. Un dossier complet envoyé tôt est plus simple à corriger en cas d’oubli détecté avant l’échéance.",
        ],
      },
    ],
  },
  {
    slug: "lettre-remboursement-sms-jeu-concours",
    title:
      "Que doit contenir une lettre de remboursement de SMS de jeu-concours ?",
    description:
      "Structurez une demande lisible avec les informations de participation et les justificatifs prévus par le règlement.",
    eyebrow: "Préparer le courrier",
    readingTime: "4 min",
    updatedAt: "13 septembre 2026",
    sections: [
      {
        title: "Identifiez clairement la demande",
        paragraphs: [
          "Indiquez vos coordonnées, le nom exact du jeu, les dates de participation et le montant demandé. Utilisez l’adresse et l’intitulé du destinataire donnés dans le règlement.",
        ],
      },
      {
        title: "Joignez une liste vérifiable",
        paragraphs: [
          "Présentez les participations de manière lisible et joignez les pièces prévues par le règlement. Si le remboursement de l’affranchissement est prévu et que vous le demandez, formulez-le explicitement.",
        ],
        bullets: [
          "nom et période du jeu ;",
          "dates des SMS concernés ;",
          "nombre de participations ;",
          "montant total demandé ;",
          "liste des justificatifs joints.",
        ],
      },
      {
        title: "Utilisez un dossier adapté au bon règlement",
        paragraphs: [
          "Un modèle générique ne suffit pas si le règlement impose une formulation, une adresse ou une pièce particulière. Lydoc prépare le dossier à partir du règlement sélectionné et des informations que vous confirmez.",
        ],
      },
    ],
  },
] as const;

export function findGuide(slug: string): Guide | undefined {
  return guides.find((guide) => guide.slug === slug);
}
