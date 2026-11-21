#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Core/NeonTypes.h"
#include "NeonAIClient.generated.h"

class FJsonObject;

/** A validated dialogue result (from the AI service or the local rules). */
struct PROJECTNEON_API FNeonDialogueResult
{
	FString Reply;
	FString Intent = TEXT("answer");
	float ValenceDelta = 0.f, ArousalDelta = 0.f, AffinityDelta = 0.f, TrustDelta = 0.f;
	bool bHasMemory = false;
	FString MemorySummary;
	float MemoryImportance = 0.4f;
	TArray<FString> MemoryTags;
	TArray<FString> CitedMemoryIds;
	FString Provider = TEXT("rules");
	bool EndsConversation() const { return Intent == TEXT("end_conversation") || Intent == TEXT("flee"); }
};

struct PROJECTNEON_API FNeonDecisionResult
{
	FString Decision;
	float Priority = 0.f;
	FString Reason;
	bool bAccepted = false;
};

/** Game-side validation: the second gate after the service's own schema checks. */
namespace NeonAIValidation
{
	/** Parses + clamps a dialogue response. Returns false if it must be discarded. */
	PROJECTNEON_API bool ParseDialogue(const TSharedPtr<FJsonObject>& Json, const TSet<FString>& KnownMemoryIds, FNeonDialogueResult& Out);
	/** A decision is accepted only if it is one of the allowed actions. */
	PROJECTNEON_API bool ParseDecision(const TSharedPtr<FJsonObject>& Json, const TArray<FString>& Allowed, FNeonDecisionResult& Out);
}

/**
 * Talks to the optional AI orchestration service (neon/ai_service) over HTTP.
 * Asynchronous, budgeted (MaxInFlight), and always optional: when the service is down,
 * slow, busy or returns something invalid, callers fall back to deterministic game rules.
 * No API keys live in the game — the service holds them.
 */
UCLASS(config = Game)
class PROJECTNEON_API UNeonAIClient : public UGameInstanceSubsystem
{
	GENERATED_BODY()
public:
	UPROPERTY(Config) bool bEnabled = true;
	UPROPERTY(Config) FString ServiceUrl = TEXT("http://127.0.0.1:8787");
	UPROPERTY(Config) float RequestTimeoutSeconds = 20.f;
	UPROPERTY(Config) int32 MaxInFlight = 2;
	UPROPERTY(Config) float DecisionCooldownSeconds = 45.f;

	virtual void Initialize(FSubsystemCollectionBase& Collection) override;

	bool IsAvailable() const { return bEnabled && bServiceAvailable; }
	const FString& GetProviderName() const { return ProviderName; }
	void CheckHealth();

	using FJsonCallback = TFunction<void(bool /*bOk*/, TSharedPtr<FJsonObject> /*Body*/)>;
	/**
	 * POST JSON. High-priority requests (player dialogue) may exceed the in-flight budget by one;
	 * low-priority ones (NPC decisions) are dropped when the budget is full — the NPC keeps its
	 * utility-AI decision instead.
	 */
	bool Post(const FString& Path, const TSharedRef<FJsonObject>& Body, bool bHighPriority, FJsonCallback Callback);

private:
	bool bServiceAvailable = false;
	FString ProviderName = TEXT("rules");
	int32 InFlight = 0;
};
