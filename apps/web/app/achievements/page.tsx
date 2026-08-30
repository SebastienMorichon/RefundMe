"use client";

import {
  ArrowRight,
  Award,
  CheckCircle2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import {
  AchievementTile,
  PageHeading,
  ReadinessRing,
} from "../../components/cockpit-ui";
import { LoadingState, Notice } from "../../components/client-ui";
import { apiFetch as fetch } from "../../lib/api-client";
import {
  apiUrl,
  formatCents,
  readCaseSummary,
  readDocument,
  readJson,
  readList,
  readUser,
  type CaseSummary,
  type UploadedDocument,
  type User,
} from "../../lib/client-data";
import {
  achievementProgress,
  buildAchievements,
  recoveryStats,
} from "../../lib/gamification";

export default function AchievementsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadProgress();
  }, []);

  async function loadProgress() {
    setLoading(true);
    setError("");
    try {
      const [sessionResponse, documentsResponse, casesResponse] =
        await Promise.all([
          fetch(`${apiUrl}/auth/me`, { credentials: "include" }),
          fetch(`${apiUrl}/documents`, { credentials: "include" }),
          fetch(`${apiUrl}/cases`, { credentials: "include" }),
        ]);
      if (sessionResponse.status === 401 || sessionResponse.status === 404) {
        router.replace("/connexion");
        return;
      }
      const [sessionPayload, documentsPayload, casesPayload] =
        await Promise.all([
          readJson(sessionResponse),
          readJson(documentsResponse),
          readJson(casesResponse),
        ]);
      const sessionUser = readUser(sessionPayload.user);
      if (
        !sessionResponse.ok ||
        !documentsResponse.ok ||
        !casesResponse.ok ||
        !sessionUser
      )
        throw new Error("Impossible de charger votre progression.");

      setUser(sessionUser);
      setDocuments(readList(documentsPayload.documents, readDocument));
      setCases(readList(casesPayload.cases, readCaseSummary));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Le service Lydoc est indisponible.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <LoadingState label="Calcul de votre progression..." />;

  const achievements = buildAchievements(documents, cases);
  const progress = achievementProgress(achievements);
  const stats = recoveryStats(cases);
  const earnedCount = achievements.filter((item) => item.earned).length;
  const nextAchievement = achievements.find((item) => !item.earned);

  return (
    <AppShell
      active="achievements"
      email={user?.email}
      isAdmin={user?.role === "ADMIN"}
    >
      <div className="page-container py-7 sm:py-9">
        <PageHeading
          eyebrow="Gamification utile"
          title="Votre progression"
          description="Chaque réussite correspond à une étape réellement accomplie dans vos démarches."
        />

        {error ? (
          <div className="mt-6">
            <Notice tone="error">
              {error}{" "}
              <button
                type="button"
                onClick={loadProgress}
                className="ml-2 inline-flex items-center gap-1 font-extrabold underline"
              >
                <RefreshCw size={13} /> Réessayer
              </button>
            </Notice>
          </div>
        ) : null}

        <section className="surface mt-6 overflow-hidden">
          <div className="grid lg:grid-cols-[260px_1fr_300px]">
            <div className="flex items-center gap-5 border-b border-[#e3e9e6] p-5 sm:p-6 lg:border-b-0 lg:border-r">
              <ReadinessRing value={progress} size="large" />
              <div>
                <p className="text-xs font-extrabold text-[#24332c]">
                  Parcours {stats.level.toLowerCase()}
                </p>
                <p className="mt-1 text-xs leading-5 text-[#7b8781]">
                  {earnedCount} réussite{earnedCount > 1 ? "s" : ""} sur{" "}
                  {achievements.length}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 border-b border-[#e3e9e6] lg:border-b-0 lg:border-r">
              <ProgressMetric
                label="Potentiel identifié"
                value={formatCents(stats.detectedCents)}
              />
              <ProgressMetric
                label="Réellement récupéré"
                value={formatCents(stats.refundedCents)}
                positive
              />
            </div>
            <div className="p-5 sm:p-6">
              <p className="text-[10px] font-extrabold uppercase text-[#849089]">
                Prochain jalon
              </p>
              {nextAchievement ? (
                <>
                  <p className="mt-2 text-sm font-extrabold text-[#24332c]">
                    {nextAchievement.title}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#7b8781]">
                    {nextAchievement.description}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm font-extrabold text-[#087a55]">
                    Parcours complété
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#7b8781]">
                    Toutes les réussites actuelles sont débloquées.
                  </p>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="surface mt-5 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#e3e9e6] px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-sm font-extrabold text-[#24332c]">
                Jalons du parcours
              </h2>
              <p className="mt-1 text-xs text-[#7b8781]">
                Les réussites verrouillées indiquent simplement la prochaine
                étape possible.
              </p>
            </div>
            <Award size={18} className="text-[#087a55]" />
          </div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3">
            {achievements.map((achievement) => (
              <div
                key={achievement.id}
                className="border-b border-[#e5ebe8] px-5 last:border-b-0 sm:[&:nth-child(odd)]:border-r xl:[&:nth-child(odd)]:border-r-0 xl:[&:not(:nth-child(3n))]:border-r"
              >
                <AchievementTile achievement={achievement} compact />
              </div>
            ))}
          </div>
        </section>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_360px]">
          <section className="surface p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#e9f6ef] text-[#087a55]">
                <Sparkles size={17} />
              </span>
              <div>
                <h2 className="text-sm font-extrabold text-[#24332c]">
                  Une progression sans pression
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#66736d]">
                  Lydoc ne récompense ni les dépenses ni la fréquence de
                  connexion. Seules les démarches utiles et les remboursements
                  confirmés font avancer ce parcours.
                </p>
              </div>
            </div>
          </section>

          <section className="surface p-5 sm:p-6">
            <CheckCircle2 size={19} className="text-[#087a55]" />
            <h2 className="mt-3 text-sm font-extrabold text-[#24332c]">
              Continuer à avancer
            </h2>
            <p className="mt-2 text-xs leading-5 text-[#7b8781]">
              Consultez vos dossiers pour retrouver la prochaine action
              concrète.
            </p>
            <a
              href="/cases"
              className="mt-4 inline-flex items-center gap-2 text-xs font-extrabold text-[#087a55] hover:text-[#066344]"
            >
              Voir mes dossiers <ArrowRight size={14} />
            </a>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function ProgressMetric({
  label,
  value,
  positive = false,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="flex min-h-[156px] flex-col justify-center border-r border-[#e3e9e6] px-5 last:border-r-0 sm:px-6">
      <p className="text-[10px] font-extrabold uppercase text-[#849089]">
        {label}
      </p>
      <p
        className={`mt-3 text-2xl font-extrabold ${
          positive ? "text-[#087a55]" : "text-[#17211d]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
