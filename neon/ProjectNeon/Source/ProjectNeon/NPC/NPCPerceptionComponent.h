#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Core/NeonTypes.h"
#include "NPCPerceptionComponent.generated.h"

/**
 * Sight (range + field of view + line-of-sight trace) and hearing (radius per event).
 * A lightweight equivalent of UAIPerceptionComponent that works without a nav mesh and
 * lets every world event carry its own audible/visible radius.
 */
UCLASS(ClassGroup = (Neon), meta = (BlueprintSpawnableComponent))
class PROJECTNEON_API UNPCPerceptionComponent : public UActorComponent
{
	GENERATED_BODY()
public:
	UNPCPerceptionComponent();

	UPROPERTY(EditAnywhere) float SightRange = 3500.f;        // cm
	UPROPERTY(EditAnywhere) float HalfFieldOfViewDeg = 75.f;
	UPROPERTY(EditAnywhere) float HearingMultiplier = 1.f;

	bool CanSee(const FVector& Point, const AActor* IgnoreActor = nullptr, float MaxRange = -1.f) const;
	/** Called by the sim for every published event; forwards to the NPC if sensed. */
	void TrySenseEvent(const FNeonWorldEvent& Event);

	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

private:
	double LastSawPlayerVehicle = -10.0;
	double LastSawPlayerOnFoot = -10.0;
};
