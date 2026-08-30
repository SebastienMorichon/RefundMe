import { Brand } from "./brand";

const columns = [
  {
    title: "Produit",
    links: [
      ["Comment ça marche", "/#fonctionnement"],
      ["Offres", "/#tarifs"],
      ["Sécurité", "/securite"],
      ["FAQ", "/faq"],
    ],
  },
  {
    title: "Lydoc",
    links: [
      ["Contact", "/contact"],
      ["Se connecter", "/connexion"],
      ["Créer un compte", "/inscription"],
    ],
  },
  {
    title: "Informations",
    links: [
      ["Conditions d’utilisation", "/cgu"],
      ["Offre payante", "/cgv"],
      ["Confidentialité", "/confidentialite"],
      ["Cookies", "/cookies"],
      ["Mentions légales", "/mentions-legales"],
    ],
  },
];

export function PublicFooter() {
  return (
    <footer className="border-t border-[#dce5e0] bg-white">
      <div className="page-container grid gap-10 py-14 md:grid-cols-[1.2fr_2fr]">
        <div>
          <Brand />
          <p className="mt-4 max-w-xs text-sm leading-6 text-[#66736d]">
            Le service qui transforme vos factures en dossiers de remboursement
            simples et suivis.
          </p>
          <p className="mt-5 text-sm font-semibold text-[#17211d]">
            contact.lydoc@gmail.com
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {columns.map((column) => (
            <div key={column.title}>
              <p className="text-sm font-extrabold text-[#17211d]">
                {column.title}
              </p>
              <ul className="mt-4 grid gap-3 text-sm text-[#66736d]">
                {column.links.map(([label, href]) => (
                  <li key={href}>
                    <a href={href} className="hover:text-[#087a55]">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-[#e6ebf1]">
        <div className="page-container flex flex-col gap-2 py-5 text-xs text-[#7b8781] sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Lydoc. Tous droits réservés.</p>
          <p>
            Lydoc prépare votre dossier selon le règlement applicable. Le
            remboursement reste décidé par l’organisateur.
          </p>
        </div>
      </div>
    </footer>
  );
}
