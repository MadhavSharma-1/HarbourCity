#pragma once

#include "CoreMinimal.h"
#include "AI/NeonAIClient.h"

class ANeonNPC;

/**
 * Offline conversation brain used when the AI service is unavailable (and as a safety net).
 * It is deliberately conservative: every factual claim comes from the NPC's own retrieved
 * memories or from places everyone in the district knows. If nothing matches, the NPC says so.
 */
namespace NeonRuleDialogue
{
	PROJECTNEON_API FNeonDialogueResult Respond(ANeonNPC* NPC, const FString& PlayerLine, const TArray<FNeonMemory>& Recalled);
	/** "Did you hear…" style line built from a memory, phrased according to its source. */
	PROJECTNEON_API FString TellMemory(const ANeonNPC* NPC, const FNeonMemory& M, double Now);
	/** "about 200 metres north of here" (X = north, Y = east in this project). */
	PROJECTNEON_API FString Directions(const FVector& From, const FVector& To);
}
