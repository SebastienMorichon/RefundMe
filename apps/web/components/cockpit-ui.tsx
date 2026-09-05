import { Check, LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
import type { Achievement, AchievementId } from "../lib/gamification";
import {
  AnalysisIcon,
  ArchiveIcon,
  CaseFolderIcon,
  DetectionIcon,
  ProcessingIcon,
  ReadyCaseIcon,
  RefundIcon,
  SendCaseIcon,
} from "./lydoc-icons";

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div>
        <p className="text-[10px] font-extrabold uppercase text-[#7c8982]">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-extrabold text-[#17211d] sm:text-[30px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#66736d]">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

export function ReadinessRing({
  value,
  size = "large",
}: {
  value: number;
  size?: "small" | "large";
}) {
  const clamped = Math.min(100, Math.max(0, value));
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const dimensions = size === "large" ? "h-[126px] w-[126px]" : "h-16 w-16";

  return (
    <div
      className={`relative shrink-0 ${dimensions}`}
      aria-label={`${clamped} %`}
    >
      <svg
        viewBox="0 0 104 104"
        className="h-full w-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="52"
          cy="52"
          r={radius}
          fill="none"
          stroke="#e3ebe7"
          strokeWidth="7"
        />
        <circle
          cx="52"
          cy="52"
          r={radius}
          fill="none"
          stroke="#087a55"
          strokeLinecap="round"
          strokeWidth="7"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span
        className={`absolute inset-0 grid place-items-center font-extrabold text-[#17211d] ${
          size === "large" ? "text-2xl" : "text-xs"
        }`}
      >
        {clamped}%
      </span>
    </div>
  );
}

export function RecoveryJourney({ current }: { current: number }) {
  const steps = [
    { label: "Détection", icon: DetectionIcon },
    { label: "Préparation", icon: ReadyCaseIcon },
    { label: "Envoi", icon: SendCaseIcon },
    { label: "Traitement", icon: ProcessingIcon },
    { label: "Remboursement", icon: RefundIcon },
  ];

  return (
    <ol
      className="grid gap-3 sm:grid-cols-5 sm:gap-0"
      aria-label="Parcours de récupération"
    >
      {steps.map(({ label, icon: StepIcon }, index) => {
        const complete = index < current;
        const active = index === current;
        return (
          <li
            key={label}
            className="relative flex items-center gap-3 sm:block sm:text-center"
          >
            {index > 0 ? (
              <span
                className={`absolute right-1/2 top-4 hidden h-px w-full sm:block ${
                  index <= current ? "bg-[#087a55]" : "bg-[#d7e0db]"
                }`}
              />
            ) : null}
            <span
              className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-extrabold sm:mx-auto ${
                complete
                  ? "border-[#087a55] bg-[#087a55] text-white"
                  : active
                    ? "border-[#087a55] bg-white text-[#087a55]"
                    : "border-[#cbd5d0] bg-white text-[#85918b]"
              }`}
            >
              {complete ? (
                <Check size={15} strokeWidth={3} />
              ) : (
                <StepIcon size={19} />
              )}
            </span>
            <span
              className={`relative z-10 mt-0 text-xs font-bold sm:mt-2 sm:block ${
                complete || active ? "text-[#087a55]" : "text-[#7b8781]"
              }`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function AchievementTile({
  achievement,
  compact = false,
}: {
  achievement: Achievement;
  compact?: boolean;
}) {
  const Icon = achievementIcon(achievement.id);
  return (
    <div
      className={`flex items-start gap-3 ${compact ? "py-3" : "min-h-[132px] border-r border-[#e5ebe8] p-5 last:border-r-0"}`}
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border ${
          achievement.earned
            ? "border-[#b9dbc9] bg-[#e9f6ef] text-[#087a55]"
            : "border-[#dfe6e2] bg-[#f7f9f8] text-[#9aa49f]"
        }`}
      >
        {achievement.earned ? <Icon size={17} /> : <LockKeyhole size={15} />}
      </span>
      <div>
        <p
          className={`text-sm font-extrabold ${
            achievement.earned ? "text-[#24332c]" : "text-[#7d8983]"
          }`}
        >
          {achievement.title}
        </p>
        <p className="mt-1 text-xs leading-5 text-[#7b8781]">
          {achievement.description}
        </p>
      </div>
    </div>
  );
}

function achievementIcon(id: AchievementId) {
  const icons = {
    FIRST_ANALYSIS: AnalysisIcon,
    FIRST_CASE: CaseFolderIcon,
    CASE_READY: ReadyCaseIcon,
    FIRST_SEND: SendCaseIcon,
    FIRST_REFUND: RefundIcon,
    SECURE_ARCHIVE: ArchiveIcon,
  };
  return icons[id];
}
