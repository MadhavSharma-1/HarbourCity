#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Core/NeonTypes.h"
#include "NPCRelationshipComponent.generated.h"

/** Affinity, trust, familiarity and romance toward other NPCs and the player. Evolves through interactions. */
UCLASS(ClassGroup = (Neon), meta = (BlueprintSpawnableComponent))
class PROJECTNEON_API UNPCRelationshipComponent : public UActorComponent
{
	GENERATED_BODY()
public:
	UPROPERTY() TArray<FNeonRelationship> Relationships;

	FNeonRelationship& Get(FName Other);
	const FNeonRelationship* Find(FName Other) const;
	void Adjust(FName Other, float DAffinity, float DTrust, float DFamiliarity, double Now);
	/** stranger, acquaintance, friend, close friend, partner, rival, enemy */
	FString Label(FName Other) const;
	/** Best candidate to hang out with among the given ids. */
	FName FavouriteAmong(const TArray<FName>& Candidates) const;
};
