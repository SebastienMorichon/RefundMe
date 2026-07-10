import { assertRuleCanBeUsed, euro, type AdministrativeCase, type GameRule } from "@lydoc/domain";

export class CreateAdministrativeCase {
  execute(input: {
    ownerId: string;
    gameRule: GameRule;
    confidence?: number;
  }): AdministrativeCase {
    assertRuleCanBeUsed(input.gameRule);

    const createdCase: AdministrativeCase = {
      id: crypto.randomUUID(),
      ownerId: input.ownerId,
      gameRuleId: input.gameRule.id,
      status: "WAITING_FOR_USER_DOCUMENTS",
      estimatedRecoverable: input.gameRule.reimbursement,
      serviceFee: euro(299),
    };

    return input.confidence === undefined
      ? createdCase
      : { ...createdCase, confidence: input.confidence };
  }
}
