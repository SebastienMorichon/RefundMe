import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import { PrismaService } from "../prisma/prisma.service";

type PacketLine = Readonly<{ label: string; value: string }>;

@Injectable()
export class PacketsService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(caseId: string, ownerId: string) {
    const administrativeCase = await this.prisma.administrativeCase.findFirst({
      where: { id: caseId, ownerId },
      include: {
        owner: { select: { email: true } },
        gameRule: { include: { organizer: true } },
        documents: { include: { document: { select: { kind: true, originalName: true } } } },
        payment: { select: { status: true, paidAt: true } },
      },
    });
    if (!administrativeCase?.gameRule) {
      throw new NotFoundException("Dossier introuvable.");
    }
    if (!canGeneratePacket(administrativeCase.status)) {
      throw new BadRequestException("Le dossier doit etre complet avant de generer son apercu.");
    }

    const preview = administrativeCase.payment?.status !== "PAID";
    const bytes = await createCasePacket({
      caseId: administrativeCase.id,
      customerEmail: administrativeCase.owner.email,
      organizer: administrativeCase.gameRule.organizer.name,
      gameName: administrativeCase.gameRule.name,
      estimatedRecoverableCents: administrativeCase.estimatedRecoverableCents,
      serviceFeeCents: administrativeCase.serviceFeeCents,
      documents: administrativeCase.documents.map(({ document }) => document.originalName),
      createdAt: administrativeCase.createdAt,
      paidAt: administrativeCase.payment?.paidAt ?? null,
      preview,
    });

    return { bytes: Buffer.from(bytes), preview };
  }
}

export function canGeneratePacket(status: string): boolean {
  return ["READY_TO_PAY", "PAID", "GENERATED", "PRINT_READY", "SENT", "REFUNDED"].includes(status);
}

export async function createCasePacket(input: {
  caseId: string;
  customerEmail: string;
  organizer: string;
  gameName: string;
  estimatedRecoverableCents: number;
  serviceFeeCents: number;
  documents: string[];
  createdAt: Date;
  paidAt: Date | null;
  preview: boolean;
}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const fontDirectory = resolve(__dirname, "../../../assets/fonts");
  const regular = await document.embedFont(readFileSync(resolve(fontDirectory, "Poppins-Regular.ttf")), { subset: true });
  const bold = await document.embedFont(readFileSync(resolve(fontDirectory, "Poppins-SemiBold.ttf")), { subset: true });
  const page = document.addPage([595.28, 841.89]);
  const navy = rgb(0.063, 0.145, 0.267);
  const blue = rgb(0.145, 0.341, 0.961);
  const green = rgb(0.086, 0.529, 0.357);
  const grey = rgb(0.4, 0.443, 0.537);

  page.drawRectangle({ x: 0, y: 780, width: 595.28, height: 61.89, color: navy });
  page.drawText("Lydoc", { x: 44, y: 804, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText(input.preview ? "APERÇU DU DOSSIER" : "DOSSIER FINAL", {
    x: 386,
    y: 807,
    size: 9,
    font: bold,
    color: rgb(1, 1, 1),
  });

  page.drawText("Demande de remboursement", { x: 44, y: 735, size: 22, font: bold, color: navy });
  drawWrapped(page, input.gameName, 44, 709, 500, 12, regular, grey);

  const lines: PacketLine[] = [
    { label: "Organisateur", value: input.organizer },
    { label: "Référence du dossier", value: input.caseId },
    { label: "Demandeur", value: input.customerEmail },
    { label: "Montant estimé", value: formatCents(input.estimatedRecoverableCents) },
    { label: "Frais de préparation", value: formatCents(input.serviceFeeCents) },
    { label: "Gain potentiel net", value: formatCents(Math.max(0, input.estimatedRecoverableCents - input.serviceFeeCents)) },
  ];
  let y = 656;
  for (const line of lines) {
    page.drawText(line.label, { x: 44, y, size: 9, font: bold, color: grey });
    drawWrapped(page, line.value, 205, y, 330, 10, regular, navy);
    y -= 31;
  }

  page.drawRectangle({ x: 44, y: y - 4, width: 507, height: 1, color: rgb(0.86, 0.89, 0.93) });
  y -= 38;
  page.drawText("Pieces jointes", { x: 44, y, size: 14, font: bold, color: navy });
  y -= 24;
  const documents = input.documents.length ? input.documents : ["Aucune piece referencee"];
  for (const name of documents.slice(0, 8)) {
    page.drawRectangle({ x: 46, y: y + 3, width: 6, height: 6, color: green });
    y = drawWrapped(page, name, 62, y, 475, 10, regular, navy) - 8;
  }

  y -= 12;
  page.drawText("Courrier de demande", { x: 44, y, size: 14, font: bold, color: navy });
  y -= 26;
  const paragraphs = [
    `À l'attention de ${input.organizer},`,
    `Je sollicite le remboursement prévu par le règlement du jeu "${input.gameName}". Les justificatifs nécessaires sont référencés dans le présent dossier.`,
    "Je vous remercie de bien vouloir examiner cette demande et de m'informer de sa prise en charge.",
  ];
  for (const paragraph of paragraphs) {
    y = drawWrapped(page, paragraph, 44, y, 507, 10, regular, navy) - 12;
  }

  const footer = input.preview
    ? "APERÇU - NON ENVOYÉ - Le paiement est requis pour obtenir le dossier final."
    : `Dossier payé le ${formatDate(input.paidAt ?? input.createdAt)} - Prêt pour transmission.`;
  page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 52, color: rgb(0.965, 0.976, 0.988) });
  page.drawText(footer, { x: 44, y: 30, size: 8, font: bold, color: input.preview ? blue : green });
  page.drawText("L'organisateur reste seul decisionnaire de l'acceptation du remboursement.", {
    x: 44,
    y: 16,
    size: 7,
    font: regular,
    color: grey,
  });

  document.setTitle(`Dossier Lydoc ${input.caseId}`);
  document.setAuthor("Lydoc");
  document.setCreationDate(new Date());
  return document.save();
}

function drawWrapped(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
): number {
  const words = normalizePdfText(text).split(/\s+/).filter(Boolean);
  let line = "";
  let cursor = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    page.drawText(line, { x, y: cursor, size, font, color });
    line = word;
    cursor -= size + 4;
  }
  if (line) {
    page.drawText(line, { x, y: cursor, size, font, color });
    cursor -= size + 4;
  }
  return cursor;
}

function normalizePdfText(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, " ");
}

function formatCents(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} EUR`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR").format(date);
}
