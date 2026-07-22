import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import { DocumentKind } from "@prisma/client";
import { LocalEncryptedObjectStorageProvider } from "@lydoc/infrastructure";
import { readCaseValidationSnapshot } from "../eligibility/case-snapshots";
import { PrismaService } from "../prisma/prisma.service";

type PacketLine = Readonly<{ label: string; value: string }>;
type RequiredPacketDocument = Readonly<{ kind: string; label: string; required: boolean }>;
type PacketSmsCharge = Readonly<{
  label: string;
  code?: string;
  quantity: number;
  amountCents: number;
}>;
type PacketRuleConstraints = Readonly<{
  reimbursementRecipient?: string;
  reimbursementAddress?: string;
  reimbursementEmail?: string;
  reimbursementDeadline?: string;
  reimbursementMethod?: string;
  requiredLetterMentions: string[];
}>;
type PacketAttachment = Readonly<{
  name: string;
  kind: DocumentKind;
  mimeType: string;
  bytes: Uint8Array;
}>;

@Injectable()
export class PacketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalEncryptedObjectStorageProvider,
  ) {}

  async generate(caseId: string, ownerId: string) {
    return this.build(caseId, ownerId, false);
  }

  async generatePostalPacket(caseId: string, ownerId: string) {
    return this.build(caseId, ownerId, true);
  }

  private async build(caseId: string, ownerId: string, forceFinal: boolean) {
    const administrativeCase = await this.prisma.administrativeCase.findFirst({
      where: { id: caseId, ownerId },
      include: {
        owner: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            postalAddress: true,
            postalCode: true,
            city: true,
            country: true,
            phoneNumber: true,
            operatorCustomerReference: true,
          },
        },
        gameRule: { include: { organizer: true } },
        documents: {
          orderBy: { createdAt: "asc" },
          include: {
            document: {
              select: {
                id: true,
                kind: true,
                originalName: true,
                mimeType: true,
                storageBucket: true,
                storageKey: true,
                checksumSha256: true,
                sizeBytes: true,
              },
            },
          },
        },
        payment: { select: { status: true, paidAt: true } },
      },
    });
    if (!administrativeCase?.gameRule) {
      throw new NotFoundException("Dossier introuvable.");
    }
    if (!canGeneratePacket(administrativeCase.status)) {
      throw new BadRequestException("Le dossier doit etre complet avant de generer son apercu.");
    }

    const validation = readCaseValidationSnapshot(administrativeCase.validationSnapshotJson);
    if (!administrativeCase.validatedAt || !validation) {
      throw new BadRequestException("Validez le recapitulatif du dossier avant de generer le PDF.");
    }

    const requiredDocuments = readRequiredDocuments(validation.rule.requiredDocuments);
    const validatedDocumentIds = new Set(validation.documents.map((document) => document.id));
    const validatedDocuments = administrativeCase.documents.filter(({ document }) => validatedDocumentIds.has(document.id));
    const missingDocumentLabels = findMissingRequiredDocumentLabels(
      requiredDocuments,
      validatedDocuments.map(({ document }) => document.kind),
    );
    if (missingDocumentLabels.length > 0) {
      throw new BadRequestException(
        `Le dossier est incomplet. Ajoutez les pieces suivantes avant de generer le PDF : ${missingDocumentLabels.join(", ")}.`,
      );
    }

    const selfService = administrativeCase.fulfillmentMode === "SELF_SERVICE";
    const preview = !shouldGenerateFinalPacket(forceFinal, administrativeCase.fulfillmentMode, administrativeCase.payment?.status);
    const ruleConstraints = readRuleConstraints(validation.rule.constraints);
    const smsCharges = readSmsCharges(administrativeCase.complianceSnapshotJson);
    const attachments = preview
      ? []
      : await Promise.all(validatedDocuments.map(({ document }) => this.readAttachment(document, ownerId)));
    const customer = validation.customer;
    const bytes = await createCasePacket({
      caseId: administrativeCase.id,
      customerEmail: customer.email,
      customerName: [customer.firstName, customer.lastName].filter(Boolean).join(" "),
      customerAddress: [
        customer.postalAddress,
        [customer.postalCode, customer.city].filter(Boolean).join(" "),
        customer.country,
      ].filter(Boolean).join(", "),
      customerPhone: customer.phoneNumber,
      customerOperatorReference: customer.operatorCustomerReference,
      organizer: validation.rule.organizerName,
      gameName: validation.rule.name,
      estimatedRecoverableCents: validation.estimatedRecoverableCents,
      serviceFeeCents: selfService ? 0 : validation.serviceFeeCents,
      documents: validatedDocuments.map(({ document }) => document.originalName),
      requiredDocuments,
      ruleConstraints,
      smsCharges,
      attachments,
      createdAt: administrativeCase.createdAt,
      paidAt: administrativeCase.payment?.paidAt ?? null,
      preview,
      fulfillmentMode: selfService ? "SELF_SERVICE" : "MANAGED_POSTAL",
    });

    if (selfService && administrativeCase.status === "READY_TO_PAY") {
      await this.prisma.administrativeCase.update({
        where: { id: administrativeCase.id },
        data: { status: "GENERATED" },
      });
    }

    return { bytes: Buffer.from(bytes), preview };
  }

  private async readAttachment(
    document: {
      kind: DocumentKind;
      originalName: string;
      mimeType: string;
      storageBucket: string;
      storageKey: string;
      checksumSha256: string;
      sizeBytes: number;
    },
    ownerId: string,
  ): Promise<PacketAttachment> {
    let bytes: Uint8Array;
    try {
      bytes = await this.storage.getDecryptedObject({
        object: {
          bucket: document.storageBucket,
          key: document.storageKey,
          checksumSha256: document.checksumSha256,
          sizeBytes: document.sizeBytes,
        },
        encryptionContext: { ownerId, documentKind: document.kind },
      });
    } catch {
      throw new BadRequestException(
        `La piece "${document.originalName}" ne peut pas etre dechiffree. Supprimez ce dossier puis redeposez les pieces avec la cle de chiffrement actuelle.`,
      );
    }

    return {
      name: document.originalName,
      kind: document.kind,
      mimeType: document.mimeType,
      bytes,
    };
  }
}

export function canGeneratePacket(status: string): boolean {
  return ["READY_TO_PAY", "PAID", "GENERATED", "PRINT_READY", "SENT", "REFUNDED"].includes(status);
}

export function shouldGenerateFinalPacket(
  forceFinal: boolean,
  fulfillmentMode: string | null,
  paymentStatus: string | undefined,
): boolean {
  return forceFinal || fulfillmentMode === "SELF_SERVICE" || paymentStatus === "PAID";
}

export function findMissingRequiredDocumentLabels(requiredDocuments: unknown, attachedKinds: Iterable<string>): string[] {
  const suppliedKinds = new Set(attachedKinds);
  return readRequiredDocuments(requiredDocuments)
    .filter((document) => document.required && !suppliedKinds.has(document.kind))
    .map((document) => document.label);
}

export async function createCasePacket(input: {
  caseId: string;
  customerEmail: string;
  customerName?: string;
  customerAddress?: string;
  customerPhone?: string;
  customerOperatorReference?: string;
  organizer: string;
  gameName: string;
  estimatedRecoverableCents: number;
  serviceFeeCents: number;
  documents: string[];
  requiredDocuments?: RequiredPacketDocument[];
  ruleConstraints?: PacketRuleConstraints;
  smsCharges?: PacketSmsCharge[];
  attachments?: PacketAttachment[];
  createdAt: Date;
  paidAt: Date | null;
  preview: boolean;
  fulfillmentMode?: "SELF_SERVICE" | "MANAGED_POSTAL";
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
  page.drawText(input.preview ? "APERCU DU DOSSIER" : "DOSSIER FINAL", {
    x: 386,
    y: 807,
    size: 9,
    font: bold,
    color: rgb(1, 1, 1),
  });

  page.drawText("Demande de remboursement", { x: 44, y: 735, size: 22, font: bold, color: navy });
  drawWrapped(page, shortenPdfText(input.gameName, 180), 44, 709, 500, 12, regular, grey);

  const lines: PacketLine[] = [
    { label: "Organisateur", value: input.organizer },
    { label: "Reference du dossier", value: input.caseId },
    { label: "Demandeur", value: input.customerName ? `${input.customerName} - ${input.customerEmail}` : input.customerEmail },
    { label: "Montant demande", value: formatCents(input.estimatedRecoverableCents) },
    { label: input.fulfillmentMode === "SELF_SERVICE" ? "Coût du dossier" : "Prise en charge Lydoc", value: formatCents(input.serviceFeeCents) },
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
  page.drawText("Participations SMS detectees", { x: 44, y, size: 14, font: bold, color: navy });
  y -= 24;
  const smsCharges = input.smsCharges ?? [];
  const smsLines = smsCharges.length
    ? smsCharges.map((charge) => `${charge.quantity} SMS${charge.code ? ` au ${charge.code}` : ""} - ${formatCents(charge.amountCents)}`)
    : ["Aucune ligne SMS detaillee dans l'analyse"];
  for (const line of smsLines.slice(0, 6)) {
    page.drawRectangle({ x: 46, y: y + 3, width: 6, height: 6, color: green });
    y = drawWrapped(page, line, 62, y, 475, 10, regular, navy) - 7;
  }
  if (smsLines.length > 6) {
    y = drawWrapped(page, `... et ${smsLines.length - 6} autre(s) ligne(s) SMS.`, 62, y, 475, 9, regular, grey) - 7;
  }

  y -= 7;
  page.drawText("Pieces jointes", { x: 44, y, size: 14, font: bold, color: navy });
  y -= 24;
  const documents = input.documents.length ? input.documents : ["Aucune piece referencee"];
  for (const name of documents.slice(0, 6)) {
    page.drawRectangle({ x: 46, y: y + 3, width: 6, height: 6, color: green });
    y = drawWrapped(page, name, 62, y, 475, 9, regular, navy) - 6;
  }

  const footer = input.preview
    ? "APERCU - Choisissez votre mode d'envoi pour obtenir le dossier complet."
    : input.fulfillmentMode === "SELF_SERVICE"
      ? "DOSSIER GRATUIT - A imprimer et envoyer par vos soins."
      : `Dossier pris en charge le ${formatDate(input.paidAt ?? input.createdAt)} - Pret pour transmission.`;
  page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 52, color: rgb(0.965, 0.976, 0.988) });
  page.drawText(footer, { x: 44, y: 30, size: 8, font: bold, color: input.preview ? blue : green });
  page.drawText("L'organisateur reste seul decisionnaire de l'acceptation du remboursement.", {
    x: 44,
    y: 16,
    size: 7,
    font: regular,
    color: grey,
  });

  appendReimbursementLetter(document, input, regular, bold);

  if (!input.preview) {
    await appendAttachments(document, input.attachments ?? [], regular, bold);
  }

  document.setTitle(`Dossier Lydoc ${input.caseId}`);
  document.setAuthor("Lydoc");
  document.setCreationDate(new Date());
  return document.save();
}

function appendReimbursementLetter(
  document: PDFDocument,
  input: Parameters<typeof createCasePacket>[0],
  regular: PDFFont,
  bold: PDFFont,
) {
  const page = document.addPage([595.28, 841.89]);
  const navy = rgb(0.063, 0.145, 0.267);
  const grey = rgb(0.4, 0.443, 0.537);
  const blue = rgb(0.145, 0.341, 0.961);
  const constraints = input.ruleConstraints ?? { requiredLetterMentions: [] };
  const recipient = shortenPdfText(constraints.reimbursementRecipient || input.organizer, 120);

  page.drawRectangle({ x: 0, y: 780, width: 595.28, height: 61.89, color: navy });
  page.drawText("Lydoc", { x: 44, y: 804, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText("COURRIER DE DEMANDE", { x: 398, y: 807, size: 9, font: bold, color: rgb(1, 1, 1) });

  let y = 738;
  y = drawWrapped(page, recipient, 330, y, 220, 10, bold, navy);
  if (constraints.reimbursementAddress) {
    y = drawWrapped(page, shortenPdfText(constraints.reimbursementAddress, 220), 330, y - 3, 220, 9, regular, navy);
  }
  if (constraints.reimbursementEmail) {
    drawWrapped(page, shortenPdfText(constraints.reimbursementEmail, 100), 330, y - 3, 220, 9, regular, blue);
  }

  let senderY = 738;
  senderY = drawWrapped(page, input.customerName || input.customerEmail, 44, senderY, 220, 10, bold, navy);
  if (input.customerAddress) senderY = drawWrapped(page, shortenPdfText(input.customerAddress, 220), 44, senderY - 3, 220, 9, regular, navy);
  if (input.customerPhone) drawWrapped(page, `Telephone : ${shortenPdfText(input.customerPhone, 30)}`, 44, senderY - 3, 220, 9, regular, navy);

  page.drawText(`Le ${formatDate(input.createdAt)}`, { x: 44, y: 680, size: 9, font: regular, color: grey });
  let cursor = 638;
  page.drawText("Objet : demande de remboursement des frais de participation", {
    x: 44,
    y: cursor,
    size: 11,
    font: bold,
    color: navy,
  });
  cursor -= 36;
  cursor = drawWrapped(page, "Madame, Monsieur,", 44, cursor, 507, 10, regular, navy) - 12;
  cursor = drawWrapped(
    page,
    `Je sollicite le remboursement de ${formatCents(input.estimatedRecoverableCents)} au titre des frais de participation au jeu "${shortenPdfText(input.gameName, 180)}", conformement aux modalites prevues par son reglement.`,
    44,
    cursor,
    507,
    10,
    regular,
    navy,
  ) - 12;

  const smsCharges = input.smsCharges ?? [];
  if (smsCharges.length > 0) {
    const totalQuantity = smsCharges.reduce((total, charge) => total + charge.quantity, 0);
    const codes = [...new Set(smsCharges.flatMap((charge) => charge.code ? [charge.code] : []))];
    cursor = drawWrapped(
      page,
      `La facture jointe fait apparaitre ${totalQuantity} SMS eligible(s)${codes.length ? ` vers le(s) numero(s) court(s) ${codes.join(", ")}` : ""}. Le detail des montants figure sur la page de synthese.`,
      44,
      cursor,
      507,
      10,
      regular,
      navy,
    ) - 12;
  }

  if (input.customerPhone || input.customerOperatorReference) {
    const participantDetails = [
      input.customerPhone ? `telephone participant : ${input.customerPhone}` : "",
      input.customerOperatorReference ? `reference client operateur : ${input.customerOperatorReference}` : "",
    ].filter(Boolean).join(" - ");
    cursor = drawWrapped(page, `Coordonnees de participation : ${shortenPdfText(participantDetails, 180)}.`, 44, cursor, 507, 9, regular, navy) - 8;
  }

  if (constraints.reimbursementDeadline) {
    cursor = drawWrapped(page, `Delai indique par le reglement : ${shortenPdfText(constraints.reimbursementDeadline, 180)}.`, 44, cursor, 507, 9, regular, navy) - 8;
  }
  if (constraints.reimbursementMethod) {
    cursor = drawWrapped(page, `Mode de remboursement demande : ${shortenPdfText(constraints.reimbursementMethod, 100)}.`, 44, cursor, 507, 9, regular, navy) - 8;
  }

  const mentions = constraints.requiredLetterMentions.slice(0, 5);
  if (mentions.length > 0) {
    page.drawText("Mentions prevues par le reglement", { x: 44, y: cursor, size: 10, font: bold, color: navy });
    cursor -= 21;
    for (const mention of mentions) {
      page.drawRectangle({ x: 47, y: cursor + 3, width: 4, height: 4, color: blue });
      cursor = drawWrapped(page, shortenPdfText(mention, 160), 61, cursor, 486, 8, regular, navy) - 5;
    }
    cursor -= 4;
  }

  const requiredLabels = (input.requiredDocuments ?? [])
    .filter((document) => document.required)
    .map((document) => document.label);
  if (requiredLabels.length > 0) {
    cursor = drawWrapped(
      page,
      `Vous trouverez jointes les pieces demandees : ${shortenPdfText(requiredLabels.join(", "), 320)}.`,
      44,
      cursor,
      507,
      9,
      regular,
      navy,
    ) - 10;
  }

  cursor = drawWrapped(
    page,
    "Je vous remercie de bien vouloir proceder a l'examen de cette demande et de m'informer de sa prise en charge.",
    44,
    Math.max(cursor, 145),
    507,
    10,
    regular,
    navy,
  ) - 18;
  page.drawText("Le demandeur", { x: 390, y: Math.max(cursor, 102), size: 10, font: bold, color: navy });
  drawWrapped(page, input.customerName || input.customerEmail, 390, Math.max(cursor - 18, 84), 160, 8, regular, grey);

  page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 45, color: rgb(0.965, 0.976, 0.988) });
  page.drawText(`Reference Lydoc : ${input.caseId}`, { x: 44, y: 19, size: 7, font: regular, color: grey });
}

async function appendAttachments(
  target: PDFDocument,
  attachments: PacketAttachment[],
  regular: PDFFont,
  bold: PDFFont,
) {
  for (const [index, attachment] of attachments.entries()) {
    await appendAttachmentDivider(target, attachment, index + 1, regular, bold);

    if (attachment.mimeType === "application/pdf") {
      await appendPdfAttachment(target, attachment.bytes);
      continue;
    }

    if (attachment.mimeType === "image/png" || attachment.mimeType === "image/jpeg") {
      await appendImageAttachment(target, attachment);
      continue;
    }

    appendUnsupportedAttachmentPage(target, attachment, regular, bold);
  }
}

async function appendAttachmentDivider(
  document: PDFDocument,
  attachment: PacketAttachment,
  index: number,
  regular: PDFFont,
  bold: PDFFont,
) {
  const page = document.addPage([595.28, 841.89]);
  const navy = rgb(0.063, 0.145, 0.267);
  const grey = rgb(0.4, 0.443, 0.537);
  page.drawRectangle({ x: 0, y: 780, width: 595.28, height: 61.89, color: navy });
  page.drawText("Lydoc", { x: 44, y: 804, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText(`PIECE ${index}`, { x: 456, y: 807, size: 9, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Piece jointe", { x: 44, y: 720, size: 22, font: bold, color: navy });
  drawWrapped(page, attachment.name, 44, 690, 500, 13, regular, navy);
  drawWrapped(page, `Type: ${formatDocumentKind(attachment.kind)} - Format: ${attachment.mimeType}`, 44, 650, 500, 10, regular, grey);
  drawWrapped(page, "Le document original est reproduit dans les pages suivantes.", 44, 612, 500, 10, regular, grey);
}

async function appendPdfAttachment(document: PDFDocument, bytes: Uint8Array) {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = await document.copyPages(source, source.getPageIndices());
  for (const page of pages) {
    document.addPage(page);
  }
}

async function appendImageAttachment(document: PDFDocument, attachment: PacketAttachment) {
  const image = attachment.mimeType === "image/png"
    ? await document.embedPng(attachment.bytes)
    : await document.embedJpg(attachment.bytes);
  const page = document.addPage([595.28, 841.89]);
  drawCenteredImage(page, image);
}

function appendUnsupportedAttachmentPage(
  document: PDFDocument,
  attachment: PacketAttachment,
  regular: PDFFont,
  bold: PDFFont,
) {
  const page = document.addPage([595.28, 841.89]);
  const navy = rgb(0.063, 0.145, 0.267);
  const grey = rgb(0.4, 0.443, 0.537);
  page.drawText("Piece non integrable automatiquement", { x: 44, y: 735, size: 18, font: bold, color: navy });
  drawWrapped(page, attachment.name, 44, 700, 500, 11, regular, navy);
  drawWrapped(page, `Format recu: ${attachment.mimeType}`, 44, 670, 500, 10, regular, grey);
}

function drawCenteredImage(page: PDFPage, image: PDFImage) {
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const margin = 36;
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  });
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

function shortenPdfText(text: string, maxLength: number): string {
  const normalized = normalizePdfText(text).replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function formatCents(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} EUR`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR").format(date);
}

function readRequiredDocuments(value: unknown): RequiredPacketDocument[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const document = item as Record<string, unknown>;
    return typeof document.kind === "string" &&
      Object.values(DocumentKind).includes(document.kind as DocumentKind) &&
      typeof document.label === "string" &&
      typeof document.required === "boolean"
      ? [{ kind: document.kind, label: document.label, required: document.required }]
      : [];
  });
}

function readRuleConstraints(value: unknown): PacketRuleConstraints {
  const constraints = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const readString = (key: string) => typeof constraints[key] === "string" && constraints[key].trim()
    ? constraints[key] as string
    : undefined;
  const reimbursementRecipient = readString("reimbursementRecipient");
  const reimbursementAddress = readString("reimbursementAddress");
  const reimbursementEmail = readString("reimbursementEmail");
  const reimbursementDeadline = readString("reimbursementDeadline");
  const reimbursementMethod = readString("reimbursementMethod");

  return {
    ...(reimbursementRecipient ? { reimbursementRecipient } : {}),
    ...(reimbursementAddress ? { reimbursementAddress } : {}),
    ...(reimbursementEmail ? { reimbursementEmail } : {}),
    ...(reimbursementDeadline ? { reimbursementDeadline } : {}),
    ...(reimbursementMethod ? { reimbursementMethod } : {}),
    requiredLetterMentions: Array.isArray(constraints.requiredLetterMentions)
      ? constraints.requiredLetterMentions.filter((mention): mention is string => typeof mention === "string" && Boolean(mention.trim()))
      : [],
  };
}

function readSmsCharges(value: unknown): PacketSmsCharge[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const charges = (value as Record<string, unknown>).detectedSmsCharges;
  if (!Array.isArray(charges)) {
    return [];
  }

  return charges.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const charge = item as Record<string, unknown>;
    if (typeof charge.label !== "string" || typeof charge.quantity !== "number" || typeof charge.amountCents !== "number") {
      return [];
    }
    return [{
      label: charge.label,
      ...(typeof charge.code === "string" ? { code: charge.code } : {}),
      quantity: charge.quantity,
      amountCents: charge.amountCents,
    }];
  });
}

function formatDocumentKind(kind: DocumentKind): string {
  const labels: Record<DocumentKind, string> = {
    GAME_RULE_PDF: "Reglement du jeu",
    ORANGE_INVOICE: "Facture operateur",
    IDENTITY_DOCUMENT: "Piece d'identite",
    BANK_DETAILS: "RIB",
    TRAIN_TICKET: "Billet de train",
    FLIGHT_TICKET: "Billet d'avion",
    PURCHASE_PROOF: "Preuve d'achat",
    WARRANTY: "Garantie",
    OTHER: "Document",
  };
  return labels[kind] ?? "Document";
}
