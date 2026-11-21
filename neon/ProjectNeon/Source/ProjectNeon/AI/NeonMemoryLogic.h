#pragma once

#include "CoreMinimal.h"
#include "Core/NeonTypes.h"

/**
 * Pure, world-independent memory logic so it can be unit-tested (Tests/NeonAutomationTests.cpp).
 * Retrieval score = relevance (keyword overlap) + importance + recency, scaled by confidence.
 */
namespace NeonMemoryLogic
{
	/** Lowercase words with stop-words and punctuation removed. */
	PROJECTNEON_API TArray<FString> Tokenize(const FString& Text);

	PROJECTNEON_API float Relevance(const TArray<FString>& QueryTokens, const FNeonMemory& M);

	PROJECTNEON_API float Score(const TArray<FString>& QueryTokens, const FNeonMemory& M, double NowHours);

	/** Top-N memories for a query, highest score first. Memories that have expired are skipped. */
	PROJECTNEON_API TArray<FNeonMemory> Retrieve(const TArray<FNeonMemory>& All, const FString& Query, double NowHours, int32 MaxResults, float MinScore = 0.12f);

	/** Rough emotional weight of an event for this personality (used for importance). */
	PROJECTNEON_API float ImportanceFor(ENeonEventType Type, float Severity, bool bInvolvesSelf);
}
