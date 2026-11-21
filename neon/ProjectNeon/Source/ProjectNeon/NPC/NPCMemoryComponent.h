#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Core/NeonTypes.h"
#include "NPCMemoryComponent.generated.h"

/**
 * Three-level memory.
 *  Working  — what just happened / the current conversation; fades within ~1 game hour.
 *  Episodic — significant experiences (crashes, meeting the player, losing a job).
 *  Semantic — stable knowledge: places, people, facts about themselves.
 * Retrieval is relevance + importance + recency (see NeonMemoryLogic). An NPC can only
 * recall entries in its own store, which is what keeps conversations grounded.
 */
UCLASS(ClassGroup = (Neon), meta = (BlueprintSpawnableComponent))
class PROJECTNEON_API UNPCMemoryComponent : public UActorComponent
{
	GENERATED_BODY()
public:
	UPROPERTY() TArray<FNeonMemory> Memories;

	int32 MaxWorking = 16;
	int32 MaxEpisodic = 160;

	struct FParams
	{
		ENeonEventType Type = ENeonEventType::None;
		FString Summary;
		TArray<FString> Tags;
		float Importance = 0.3f;
		float Confidence = 1.f;
		ENeonInfoSource Source = ENeonInfoSource::Observed;
		FName SourceNpc;
		FString EventId;
		FVector Location = FVector::ZeroVector;
		TArray<FName> Participants;
		ENeonMemoryTier Tier = ENeonMemoryTier::Working;
		double ExpiresAt = -1.0;
		double GameTimeOverride = -1.0;
	};

	/** Store a memory. Returns false if it was already known (same EventId) and only reinforced. */
	bool Remember(const FParams& P);
	bool KnowsEvent(const FString& EventId) const;
	TArray<FNeonMemory> Recall(const FString& Query, int32 MaxResults = 6) const;
	/** Memories worth passing on in conversation, most interesting first. */
	TArray<FNeonMemory> Shareable(int32 MaxResults, double SinceHours) const;
	/** Upsert a stable fact (semantic memory) keyed by Key. */
	void SetFact(const FString& Key, const FString& Summary, const TArray<FString>& Tags, float Importance = 0.5f);
	/** Promote/forget. Called every game hour. */
	void Consolidate();
	/** Memory records formatted for the AI service sync endpoint. */
	TArray<TSharedPtr<class FJsonValue>> ToJson() const;

	double Now() const;
};
