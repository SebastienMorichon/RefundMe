"use client";

import { Bell, CheckCircle2, Mail, Send, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { LoadingState, Notice } from "../../components/client-ui";
import { apiFetch as fetch } from "../../lib/api-client";
import {
  apiUrl,
  errorMessage,
  readJson,
  readUser,
  type User,
} from "../../lib/client-data";

type NotificationItem = {
  id: string;
  caseId: string | null;
  eventType: string;
  status: string;
  sentAt: string | null;
  readAt: string | null;
  createdAt: string;
};

export default function NotificationsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const [sessionResponse, response] = await Promise.all([
        fetch(`${apiUrl}/auth/me`, { credentials: "include" }),
        fetch(`${apiUrl}/notifications`, { credentials: "include" }),
      ]);
      const [sessionPayload, payload] = await Promise.all([
        readJson(sessionResponse),
        readJson(response),
      ]);
      const sessionUser = readUser(sessionPayload.user);
      if (!sessionResponse.ok || !sessionUser)
        throw new Error("Session requise.");
      if (!response.ok) {
        throw new Error(errorMessage(payload, "Chargement impossible."));
      }
      setUser(sessionUser);
      setItems(
        Array.isArray(payload.notifications)
          ? payload.notifications.flatMap(readNotification)
          : [],
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Chargement impossible.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function open(item: NotificationItem) {
    if (!item.readAt) {
      await fetch(`${apiUrl}/notifications/${item.id}/read`, {
        method: "PATCH",
        credentials: "include",
      });
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, readAt: new Date().toISOString() }
            : candidate,
        ),
      );
    }
    if (item.caseId) window.location.href = `/cases/${item.caseId}`;
  }

  if (loading) return <LoadingState label="Chargement des notifications..." />;

  return (
    <AppShell
      active="notifications"
      email={user?.email}
      isAdmin={user?.role === "ADMIN"}
    >
      <div className="page-container py-7 sm:py-9">
        <p className="eyebrow">Suivi</p>
        <h1 className="mt-2 text-3xl font-extrabold text-[#17211d]">
          Notifications
        </h1>
        <p className="mt-2 text-sm text-[#66736d]">
          Les étapes importantes de vos dossiers.
        </p>
        {error ? (
          <div className="mt-6">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : null}
        <section className="surface mt-6 overflow-hidden">
          {items.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Bell className="mx-auto text-[#99a59f]" size={28} />
              <p className="mt-4 text-sm font-bold text-[#59665f]">
                Aucune notification pour le moment.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#e7ece9]">
              {items.map((item) => {
                const content = notificationContent(item.eventType);
                const Icon = content.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void open(item)}
                    className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-5 py-5 text-left hover:bg-[#f8faf9] sm:px-6 ${item.readAt ? "" : "bg-[#f3faf7]"}`}
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-md bg-[#e9f5ef] text-[#087a55]">
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-extrabold text-[#24332c]">
                        {content.title}
                      </span>
                      <span className="mt-1 block text-xs text-[#66736d]">
                        {content.detail}
                      </span>
                    </span>
                    <span className="text-xs text-[#849089]">
                      {formatDate(item.createdAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function readNotification(value: unknown): NotificationItem[] {
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" &&
    typeof item.eventType === "string" &&
    typeof item.status === "string" &&
    typeof item.createdAt === "string"
    ? [
        {
          id: item.id,
          caseId: typeof item.caseId === "string" ? item.caseId : null,
          eventType: item.eventType,
          status: item.status,
          sentAt: typeof item.sentAt === "string" ? item.sentAt : null,
          readAt: typeof item.readAt === "string" ? item.readAt : null,
          createdAt: item.createdAt,
        },
      ]
    : [];
}

function notificationContent(eventType: string) {
  const content = {
    CASE_VALIDATED: {
      title: "Dossier validé",
      detail: "Choisissez maintenant votre mode d’envoi.",
      icon: CheckCircle2,
    },
    PAYMENT_CONFIRMED: {
      title: "Paiement confirmé",
      detail: "Votre courrier va être préparé.",
      icon: WalletCards,
    },
    POSTAL_SUBMITTED: {
      title: "Courrier transmis",
      detail: "Le prestataire postal a reçu votre dossier.",
      icon: Send,
    },
    POSTAL_DELIVERED: {
      title: "Courrier distribué",
      detail: "Votre demande est arrivée chez l’organisateur.",
      icon: Mail,
    },
    REFUND_CONFIRMED: {
      title: "Remboursement confirmé",
      detail: "Votre dossier est terminé.",
      icon: CheckCircle2,
    },
  } as const;
  return (
    content[eventType as keyof typeof content] ?? {
      title: "Mise à jour du dossier",
      detail: "Une nouvelle étape a été enregistrée.",
      icon: Bell,
    }
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}
