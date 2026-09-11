"use client";

import {
  Banknote,
  CalendarDays,
  Check,
  ChevronDown,
  FileCheck2,
  Info,
  Mail,
  MapPin,
  ReceiptText,
  RefreshCw,
  Send,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { PageHeading } from "../../components/cockpit-ui";
import { LoadingState, Notice } from "../../components/client-ui";
import { apiFetch as fetch } from "../../lib/api-client";
import {
  apiUrl,
  formatCents,
  gamePeriodLabel,
  readGameCatalog,
  readJson,
  readUser,
  type GameCatalogItem,
  type GameChannel,
  type User,
} from "../../lib/client-data";

type RequiredDocument = {
  label: string;
  required: boolean;
};

type PostalExpense = {
  available: boolean;
  postageReimbursable: boolean;
  postageBasis: string;
  postageAmountCents: number | null;
  printingReimbursable: boolean;
  printingBasis: string;
  printingCentsPerPage: number | null;
  claimLimit: string;
  requestInstructions: string;
  requiredProofs: string[];
};

export default function RulesPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [channels, setChannels] = useState<GameChannel[]>([]);
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadRules();
  }, []);

  async function loadRules() {
    setLoading(true);
    setError("");
    try {
      const [sessionResponse, catalogResponse] = await Promise.all([
        fetch(`${apiUrl}/auth/me`, { credentials: "include" }),
        fetch(`${apiUrl}/games/catalog`),
      ]);
      if (sessionResponse.status === 401 || sessionResponse.status === 404) {
        router.replace("/connexion");
        return;
      }
      const [sessionPayload, catalogPayload] = await Promise.all([
        readJson(sessionResponse),
        readJson(catalogResponse),
      ]);
      const sessionUser = readUser(sessionPayload.user);
      if (!sessionResponse.ok || !catalogResponse.ok || !sessionUser) {
        throw new Error("Impossible de charger les règlements.");
      }
      setUser(sessionUser);
      setChannels(readGameCatalog(catalogPayload.channels));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Le service Lydoc est momentanément indisponible.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell
      active="rules"
      email={user?.email}
      isAdmin={user?.role === "ADMIN"}
    >
      <div className="mx-auto max-w-[1280px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">
        <PageHeading
          eyebrow="Bien participer"
          title="Les règlements des jeux"
          description="Retrouvez, chaîne par chaîne, les informations utiles pour participer et demander le remboursement de vos frais."
        />

        {loading ? (
          <div className="mt-8">
            <LoadingState label="Chargement des règlements…" />
          </div>
        ) : error ? (
          <div className="mt-8 space-y-4">
            <Notice tone="error">{error}</Notice>
            <button
              type="button"
              onClick={() => void loadRules()}
              className="secondary-button"
            >
              <RefreshCw size={16} /> Réessayer
            </button>
          </div>
        ) : channels.length === 0 ? (
          <EmptyRules />
        ) : (
          <div className="mt-8 space-y-10">
            <nav
              aria-label="Accès rapide aux chaînes"
              className="flex gap-2 overflow-x-auto pb-1"
            >
              {channels.map((channel) => (
                <a
                  key={channel.id}
                  href={`#chaine-${channel.id}`}
                  className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-[#cfe0d7] bg-white px-4 text-sm font-bold text-[#315746] transition-colors hover:border-[#07865e] hover:bg-[#eef8f3] hover:text-[#087a55]"
                >
                  {channel.name}
                  <span className="ml-2 text-xs font-semibold text-[#87938d]">
                    {channel.games.length}
                  </span>
                </a>
              ))}
            </nav>

            {channels.map((channel) => (
              <section
                key={channel.id}
                id={`chaine-${channel.id}`}
                aria-labelledby={`titre-${channel.id}`}
                className="scroll-mt-7"
              >
                <div className="mb-4 flex items-end justify-between gap-4 border-b border-[#dfe8e3] pb-3">
                  <div>
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.09em] text-[#07865e]">
                      Chaîne
                    </p>
                    <h2
                      id={`titre-${channel.id}`}
                      className="mt-1 text-xl font-extrabold text-[#17211d]"
                    >
                      {channel.name}
                    </h2>
                  </div>
                  <p className="text-sm text-[#718078]">
                    {channel.games.length} jeu{channel.games.length > 1 ? "x" : ""}
                  </p>
                </div>

                <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {channel.games.map((game) => {
                    const expanded = expandedRuleId === game.id;
                    return (
                      <RuleCard
                        key={game.id}
                        game={game}
                        channelName={channel.name}
                        expanded={expanded}
                        onToggle={() =>
                          setExpandedRuleId(expanded ? null : game.id)
                        }
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function RuleCard({
  game,
  channelName,
  expanded,
  onToggle,
}: {
  game: GameCatalogItem;
  channelName: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const detailsId = `reglement-${game.id}`;
  const constraints = game.constraints;
  const deadline = readText(constraints.reimbursementDeadline);
  const documents = readRequiredDocuments(game.requiredDocuments);
  const postalExpense = readPostalExpense(
    constraints.postalExpenseReimbursement,
  );
  const eligibility = readTextList(constraints.eligibilityConditions);
  const reimbursementConditions = readTextList(
    constraints.reimbursementConditions,
  );
  const generalConditions = readConditions(constraints.conditions);
  const excludedCosts = readTextList(constraints.excludedCosts);
  const address = readText(constraints.reimbursementAddress);
  const recipient = readText(constraints.reimbursementRecipient);
  const email = readText(constraints.reimbursementEmail);
  const method = readText(constraints.reimbursementMethod);
  const participationMechanism = readText(constraints.participationMechanism);
  const participationPeriod = readText(constraints.participationPeriod);
  const conditionLines = [
    ...eligibility,
    ...reimbursementConditions,
    ...generalConditions,
  ];
  const participationLimit =
    firstText(constraints, [
      "participationLimit",
      "participationLimits",
      "maximumParticipations",
      "numberOfParticipations",
      "nombreParticipations",
    ]) ||
    findRelevantLine(conditionLines, /particip/i, /(?:maximum|limite|fois|par\s+(?:jour|semaine|mois|personne|foyer))/i);
  const requestLimit =
    firstText(constraints, [
      "reimbursementRequestLimit",
      "refundRequestLimit",
      "maximumReimbursementRequests",
      "nombreDemandesRemboursement",
    ]) ||
    findRelevantLine(conditionLines, /(?:demande|rembours)/i, /(?:maximum|limite|fois|par\s+(?:jour|semaine|mois|personne|foyer|jeu))/i);
  const gameDate = readText(constraints.gameDate);

  return (
    <article
      className={`overflow-hidden rounded-[14px] border bg-white shadow-[0_12px_34px_rgba(27,63,47,0.055)] transition-[border-color,box-shadow] duration-200 ${
        expanded
          ? "border-[#8ac3aa] shadow-[0_18px_50px_rgba(17,92,65,0.12)] md:col-span-2 xl:col-span-3"
          : "border-[#dfe8e3] hover:border-[#aed1c1] hover:shadow-[0_16px_42px_rgba(27,63,47,0.09)]"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className="group flex min-h-[150px] w-full items-stretch text-left"
      >
        <span
          aria-hidden="true"
          className="w-2 shrink-0 bg-[#087a55] transition-colors group-hover:bg-[#0aa477]"
        />
        <span className="flex min-w-0 flex-1 flex-col p-5 sm:p-6">
          <span className="flex items-start justify-between gap-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[#e8f5ee] text-[#087a55]">
              <ReceiptText size={20} strokeWidth={1.9} />
            </span>
            <span className="rounded-full bg-[#f1f5f3] px-3 py-1 text-xs font-bold text-[#5f7168]">
              {channelName}
            </span>
          </span>
          <span className="mt-5 block text-lg font-extrabold leading-snug text-[#17211d]">
            {game.name}
          </span>
          <span className="mt-1 block text-sm text-[#6c7a73]">
            {gamePeriodLabel(game)}
          </span>
          <span className="mt-5 flex items-center justify-between gap-3 border-t border-[#e7eeea] pt-4 text-sm font-extrabold text-[#087a55]">
            {expanded ? "Masquer les informations" : "Voir les informations"}
            <ChevronDown
              size={18}
              className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </span>
        </span>
      </button>

      {expanded ? (
        <div
          id={detailsId}
          className="border-t border-[#dfe8e3] bg-[#fbfdfc] px-5 py-6 sm:px-7 sm:py-7"
        >
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <InfoPanel icon={CalendarDays} title="Dates du jeu">
              <p>{gamePeriodLabel(game)}</p>
              {gameDate ? (
                <KeyLine label="Date du jeu" value={formatRuleDate(gameDate)} />
              ) : null}
              {participationPeriod ? <p>{participationPeriod}</p> : null}
              <KeyLine
                label="Date limite de remboursement"
                value={deadline || "Non précisée dans le règlement"}
                important
              />
            </InfoPanel>

            <InfoPanel icon={MapPin} title="Où envoyer la demande">
              {recipient ? <p className="font-bold">{recipient}</p> : null}
              <p className={address ? "whitespace-pre-line" : "text-[#7d8983]"}>
                {address || "Adresse non précisée dans le règlement"}
              </p>
              {email ? (
                <p className="flex items-center gap-2 break-all">
                  <Mail size={15} className="shrink-0 text-[#087a55]" />
                  {email}
                </p>
              ) : null}
            </InfoPanel>

            <InfoPanel icon={Banknote} title="Remboursement">
              <KeyLine
                label="Montant indicatif"
                value={
                  game.reimbursementCents > 0
                    ? formatCents(game.reimbursementCents)
                    : "Selon les frais engagés"
                }
                important
              />
              <KeyLine
                label="Mode de remboursement"
                value={method || "Non précisé"}
              />
            </InfoPanel>

            <InfoPanel icon={Send} title="Affranchissement et impression">
              <PostalExpenseSummary value={postalExpense} />
            </InfoPanel>

            <InfoPanel icon={Users} title="Limites à respecter">
              <KeyLine
                label="Demandes de remboursement"
                value={requestLimit || "Nombre non précisé"}
              />
              {postalExpense.claimLimit ? (
                <KeyLine
                  label="Demandes de frais postaux"
                  value={postalExpense.claimLimit}
                />
              ) : null}
              <KeyLine
                label="Participations autorisées"
                value={participationLimit || "Nombre non précisé"}
              />
              {participationMechanism ? (
                <KeyLine label="Mode de participation" value={participationMechanism} />
              ) : null}
            </InfoPanel>

            <InfoPanel icon={FileCheck2} title="Documents demandés">
              {documents.length > 0 ? (
                <ul className="space-y-2">
                  {documents.map((document, index) => (
                    <li key={`${document.label}-${index}`} className="flex gap-2">
                      <Check
                        size={16}
                        className="mt-0.5 shrink-0 text-[#087a55]"
                        strokeWidth={2.5}
                      />
                      <span>
                        {document.label}
                        {!document.required ? (
                          <span className="text-[#7d8983]"> (si applicable)</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[#7d8983]">
                  Aucun document spécifique n’est indiqué.
                </p>
              )}
            </InfoPanel>
          </div>

          <DetailedConditions
            eligibility={eligibility}
            reimbursement={reimbursementConditions}
            general={generalConditions}
            excludedCosts={excludedCosts}
          />

          <div className="mt-5 flex gap-3 rounded-[10px] border border-[#d9e8e1] bg-white p-4 text-sm leading-6 text-[#57665f]">
            <Info size={18} className="mt-0.5 shrink-0 text-[#087a55]" />
            <p>
              Cette synthèse facilite la lecture du règlement. En cas de doute,
              les conditions détaillées validées par l’organisateur restent la
              référence.
            </p>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function InfoPanel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof CalendarDays;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-[#e0e9e4] bg-white p-5">
      <h3 className="flex items-center gap-2.5 text-sm font-extrabold text-[#1e2c25]">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#e9f5ef] text-[#087a55]">
          <Icon size={17} strokeWidth={2} />
        </span>
        {title}
      </h3>
      <div className="mt-4 space-y-3 text-sm leading-6 text-[#53635b]">
        {children}
      </div>
    </section>
  );
}

function KeyLine({
  label,
  value,
  important = false,
}: {
  label: string;
  value: string;
  important?: boolean;
}) {
  return (
    <p>
      <span className="block text-xs font-bold uppercase tracking-[0.04em] text-[#7c8982]">
        {label}
      </span>
      <span
        className={`mt-0.5 block ${important ? "font-extrabold text-[#26362f]" : "text-[#53635b]"}`}
      >
        {value}
      </span>
    </p>
  );
}

function PostalExpenseSummary({ value }: { value: PostalExpense }) {
  if (!value.available) {
    return (
      <p className="text-[#7d8983]">
        Le règlement ne prévoit pas explicitement le remboursement de ces frais.
      </p>
    );
  }

  const postage = value.postageReimbursable
    ? value.postageAmountCents !== null
      ? `${formatCents(value.postageAmountCents)} maximum`
      : value.postageBasis || "Remboursable selon le tarif prévu"
    : "Non remboursable";
  const printing = value.printingReimbursable
    ? value.printingCentsPerPage !== null
      ? `${formatCents(value.printingCentsPerPage)} par page`
      : value.printingBasis || "Remboursable selon le barème prévu"
    : "Non remboursable";

  return (
    <>
      <KeyLine label="Affranchissement" value={postage} />
      <KeyLine label="Impression / photocopie" value={printing} />
      {value.requestInstructions ? (
        <KeyLine label="Comment le demander" value={value.requestInstructions} />
      ) : null}
      {value.requiredProofs.length > 0 ? (
        <KeyLine
          label="Justificatifs"
          value={value.requiredProofs.join(" · ")}
        />
      ) : null}
    </>
  );
}

function DetailedConditions({
  eligibility,
  reimbursement,
  general,
  excludedCosts,
}: {
  eligibility: string[];
  reimbursement: string[];
  general: string[];
  excludedCosts: string[];
}) {
  const sections = [
    { title: "Conditions pour participer", items: eligibility },
    { title: "Conditions de remboursement", items: reimbursement },
    { title: "Autres règles importantes", items: general },
    { title: "Frais exclus", items: excludedCosts },
  ].filter((section) => section.items.length > 0);

  if (sections.length === 0) return null;

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      {sections.map((section) => (
        <section
          key={section.title}
          className="rounded-[10px] border border-[#e0e9e4] bg-white p-5"
        >
          <h3 className="text-sm font-extrabold text-[#1e2c25]">
            {section.title}
          </h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[#53635b]">
            {section.items.map((item, index) => (
              <li key={`${item}-${index}`} className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#0a9468]"
                />
                {item}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function EmptyRules() {
  return (
    <div className="mt-8 rounded-[14px] border border-dashed border-[#cddbd4] bg-white px-6 py-14 text-center">
      <ReceiptText size={32} className="mx-auto text-[#799087]" />
      <h2 className="mt-4 text-lg font-extrabold text-[#24332c]">
        Aucun règlement disponible
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#6d7b74]">
        Les règlements apparaîtront ici dès qu’ils auront été vérifiés et
        approuvés par Lydoc.
      </p>
    </div>
  );
}

function readRequiredDocuments(value: unknown): RequiredDocument[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const document = item as Record<string, unknown>;
    return typeof document.label === "string" && document.label.trim()
      ? [
          {
            label: document.label.trim(),
            required: document.required !== false,
          },
        ]
      : [];
  });
}

function readPostalExpense(value: unknown): PostalExpense {
  const input = readRecord(value);
  const postage = readRecord(input.postage);
  const printing = readRecord(input.printing);
  const claimLimit = readRecord(input.claimLimit);
  return {
    available: input.available === true,
    postageReimbursable: postage.reimbursable === true,
    postageBasis: readText(postage.basis),
    postageAmountCents: readNumber(postage.amountCents),
    printingReimbursable: printing.reimbursable === true,
    printingBasis: readText(printing.basis),
    printingCentsPerPage: readNumber(printing.centsPerPage),
    claimLimit:
      readText(claimLimit.details) || claimLimitLabel(readText(claimLimit.scope)),
    requestInstructions: readText(input.requestInstructions),
    requiredProofs: readTextList(input.requiredProofs),
  };
}

function claimLimitLabel(scope: string): string {
  const labels: Record<string, string> = {
    PER_REQUEST: "Une demande par envoi",
    PER_PARTICIPANT_PER_MONTH: "Une demande par participant et par mois",
    PER_PARTICIPANT_PER_GAME: "Une demande par participant et par jeu",
    PER_HOUSEHOLD_PER_GAME: "Une demande par foyer et par jeu",
  };
  return labels[scope] ?? "";
}

function readConditions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    const condition = readRecord(item);
    const title = readText(condition.title);
    const details = readText(condition.details);
    if (!title && !details) return [];
    return [title && details ? `${title} : ${details}` : title || details];
  });
}

function readTextList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) =>
        typeof item === "string" && item.trim() ? [item.trim()] : [],
      )
    : [];
}

function firstText(
  value: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const text = readText(value[key]);
    if (text) return text;
  }
  return "";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function findRelevantLine(
  lines: string[],
  subject: RegExp,
  limit: RegExp,
): string {
  return lines.find((line) => subject.test(line) && limit.test(line)) ?? "";
}

function formatRuleDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
