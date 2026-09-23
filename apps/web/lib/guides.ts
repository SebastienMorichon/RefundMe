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
  publishedAt?: string;
  modifiedAt?: string;
  sources?: readonly Readonly<{ title: string; url: string }>[];
  relatedSlugs?: readonly string[];
  sections: readonly GuideSection[];
}>;

export const guides: readonly Guide[] = [
  {
    slug: "sms-surtaxe-qui-contacter-remboursement",
    title: "SMS surtaxé : à qui demander un remboursement ?",
    description:
      "Organisateur du jeu, éditeur du service ou opérateur : identifiez le bon interlocuteur pour demander un remboursement ou contester des frais SMS+.",
    eyebrow: "Le bon interlocuteur",
    readingTime: "4 min",
    updatedAt: "16 septembre 2026",
    publishedAt: "2026-09-16",
    modifiedAt: "2026-09-16",
    relatedSlugs: [
      "remboursement-sms-surtaxe-jeu-concours",
      "trouver-sms-surtaxes-facture-mobile",
      "justificatifs-remboursement-sms",
    ],
    sources: [
      {
        title: "Surmafacture.fr — Comprendre SMS+ et faire une réclamation",
        url: "https://www.surmafacture.fr/sms/",
      },
      {
        title: "DGCCRF — Numéros surtaxés et pièges sur Internet",
        url: "https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/numeros-surtaxes-et-pieges-sur-internet-attention-aux-mauvaises-surprises",
      },
      {
        title: "RTL et Vous — Questions sur les jeux-concours antenne",
        url: "https://etvous.m6.fr/radio-rtl/faq/jeux-concours-antenne",
      },
    ],
    sections: [
      {
        title: "Identifiez d’abord ce qui a été facturé",
        paragraphs: [
          "Une ligne SMS+ sur votre facture ne suffit pas à déterminer la procédure de remboursement. SMS+ permet notamment de payer un contenu numérique, de participer à un jeu ou de voter à la télévision ou à la radio. Commencez par retrouver le service concerné dans votre facture et votre espace client opérateur.",
          "Notez le numéro court, le libellé, la date et le montant. Comparez-les avec vos messages conservés. Cette vérification permet de choisir entre une demande prévue par le règlement d’un jeu et une réclamation portant sur un service facturé.",
        ],
      },
      {
        title: "Pour un jeu-concours : suivez le règlement de l’organisateur",
        paragraphs: [
          "Si vous avez participé à un jeu, recherchez ses conditions de remboursement sur le site officiel de l’organisateur. La FAQ de RTL, par exemple, renvoie aux règlements de ses jeux Audiotel et SMS et présente une démarche de remboursement. Cet exemple ne permet pas de déduire les conditions d’un autre jeu.",
          "Avant de préparer le courrier, relevez dans le règlement correspondant à votre participation le destinataire, le délai, les frais concernés et les justificatifs demandés. Utilisez ces indications pour constituer votre dossier. Si un point manque ou paraît ambigu, demandez une précision à l’organisateur avant l’envoi.",
          "Lydoc aide à préparer un dossier à partir du règlement sélectionné et des informations que vous confirmez. La décision de remboursement appartient à l’organisateur : la création du dossier ne garantit pas son acceptation.",
        ],
      },
      {
        title: "Pour un service SMS+ contesté : contactez son éditeur",
        paragraphs: [
          "La plateforme Surmafacture.fr recommande de contacter l’éditeur pour une question sur le service acheté. Son annuaire permet de retrouver les coordonnées utiles. Si vous n’obtenez pas de réponse sous une semaine ou si celle-ci ne vous satisfait pas, elle indique que vous pouvez également saisir le service client de votre opérateur avec vos justificatifs.",
          "Rédigez une demande factuelle : identifiez la ligne concernée, expliquez ce que vous contestez et précisez la réponse attendue. Conservez une copie datée de votre demande et des échanges pour pouvoir présenter un historique clair.",
        ],
      },
      {
        title: "En cas de SMS suspect : distinguez signalement et réclamation",
        paragraphs: [
          "La DGCCRF invite à la prudence face aux messages inconnus demandant de rappeler un numéro ou de cliquer sur un lien. Elle oriente notamment vers Surmafacture.fr pour identifier un service et vers le 33700 pour signaler les spams. Ne poursuivez pas un échange suspect dans l’espoir de récupérer un gain annoncé.",
          "Signaler un problème sert à alerter. Cela ne remplace pas une demande individuelle de remboursement adressée au bon interlocuteur. Surmafacture.fr précise notamment que son signalement anonyme ne permet pas à l’éditeur de vous répondre.",
        ],
      },
      {
        title: "Votre liste de vérification avant de contacter le service",
        paragraphs: [
          "Préparez les éléments utiles à votre situation, sans transmettre spontanément des documents personnels sans rapport avec la demande.",
        ],
        bullets: [
          "Identifiez le service ou le jeu et la période concernée.",
          "Retrouvez les lignes facturées et les messages correspondants.",
          "Vérifiez les coordonnées du destinataire sur une source officielle.",
          "Pour un jeu, relisez les conditions et le délai du règlement applicable.",
          "Gardez une copie de votre demande, des pièces transmises et de la réponse.",
        ],
      },
    ],
  },
  {
    slug: "remboursement-sms-jeu-concours-non-recu",
    title: "Remboursement de SMS de jeu-concours non reçu : comment relancer ?",
    description:
      "Vérifiez le délai du règlement, rassemblez la preuve de votre première demande et contactez le bon service si le remboursement de vos SMS tarde.",
    eyebrow: "Suivre sa demande",
    readingTime: "4 min",
    updatedAt: "23 septembre 2026",
    publishedAt: "2026-09-23",
    modifiedAt: "2026-09-23",
    relatedSlugs: [
      "delai-demande-remboursement-jeu-concours",
      "justificatifs-remboursement-sms",
      "sms-surtaxe-qui-contacter-remboursement",
    ],
    sources: [
      {
        title: "M6+ et Vous — Questions sur les jeux-concours Audiotel et SMS",
        url: "https://etvous.m6.fr/info/jeux-concours-antenne",
      },
      {
        title: "DGCCRF — Comment régler un litige de la consommation ?",
        url: "https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/comment-regler-un-litige-de-la-consommation",
      },
      {
        title: "Surmafacture.fr — Que faire en cas de problème avec un service SMS+ ?",
        url: "https://www.surmafacture.fr/sms/",
      },
    ],
    sections: [
      {
        title: "Vérifiez d’abord le délai du règlement applicable",
        paragraphs: [
          "Un remboursement qui n’apparaît pas encore sur votre compte n’est pas nécessairement refusé. Retrouvez le règlement du jeu et de la période auxquels vous avez participé. Vérifiez le délai annoncé pour traiter ou verser le remboursement et le point de départ prévu. Ne reprenez pas le délai d’une autre émission ou d’un autre jeu.",
          "La page d’aide du groupe M6, par exemple, invite les participants à le contacter lorsque le délai indiqué dans le règlement de leur jeu est écoulé. Cette consigne concerne ses propres jeux : pour une autre participation, fiez-vous au règlement et au service officiel de l’organisateur concerné.",
        ],
      },
      {
        title: "Rassemblez les éléments de votre première demande",
        paragraphs: [
          "Avant de relancer, reprenez le dossier envoyé et vérifiez ce qu’il contenait réellement. Gardez la facture détaillée où figurent les participations concernées, la copie de votre demande, sa date et, si vous en disposez, la preuve d’envoi ou de réception. Vérifiez aussi si le règlement demandait une pièce ou une présentation particulière.",
          "Ces éléments permettent d’expliquer votre situation sans recommencer une demande à l’aveugle. Si une pièce manque, demandez au service chargé du jeu comment compléter le dossier et vérifiez si le règlement prévoit encore cette possibilité. Ne renvoyez pas spontanément des documents personnels sans lien avec la demande.",
        ],
      },
      {
        title: "Adressez une relance précise à l’organisateur",
        paragraphs: [
          "Utilisez le moyen de contact indiqué par le règlement ou sur le site officiel de l’organisateur. Précisez le nom du jeu, la période de participation, la date de votre premier envoi, les SMS concernés et le montant demandé. Demandez si le dossier a été reçu, s’il est complet et quelle suite lui sera donnée. Conservez une copie de la relance et de la réponse.",
          "Dans sa propre procédure, M6 demande notamment les coordonnées figurant sur la facture et la date d’envoi de la facture détaillée lors d’une relance après expiration du délai du règlement. Cet exemple aide à préparer un message factuel, sans remplacer les conditions de votre jeu.",
        ],
      },
      {
        title: "En cas de refus ou d’absence de réponse",
        paragraphs: [
          "Si l’organisateur refuse le remboursement, demandez le motif par écrit et comparez-le au règlement correspondant à votre participation et aux pièces que vous avez envoyées. Si le désaccord persiste avec un professionnel, la DGCCRF recommande de chercher d’abord une solution amiable et de garder la preuve de la réclamation. Selon la nature du litige, SignalConso ou le médiateur de la consommation désigné par ce professionnel peuvent ensuite être des pistes à examiner. Vérifiez les conditions de recevabilité avant de saisir un médiateur.",
          "Une contestation de SMS+ facturé pour un autre service suit un parcours différent : Surmafacture.fr oriente d’abord vers l’éditeur du service, puis vers le service client de l’opérateur si nécessaire. Un signalement de fraude sert à alerter ; il ne tient pas lieu de réclamation individuelle et ne déclenche pas à lui seul un remboursement.",
        ],
      },
      {
        title: "Votre relance en cinq points",
        paragraphs: [
          "Un message court et vérifiable facilite l’identification de votre dossier. N’annoncez pas qu’un remboursement est acquis avant que l’organisateur ait confirmé sa décision.",
        ],
        bullets: [
          "Rappelez le jeu exact et la période de participation.",
          "Indiquez la date et le mode d’envoi de la première demande.",
          "Référencez les lignes de facture et les pièces déjà transmises.",
          "Posez une question claire sur la réception, les pièces manquantes ou la décision.",
          "Conservez la réponse et vérifiez toute nouvelle instruction dans le règlement.",
        ],
      },
    ],
  },
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
