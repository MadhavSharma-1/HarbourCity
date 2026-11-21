#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Core/NeonTypes.h"
#include "NPCEmotionComponent.generated.h"

/**
 * Numeric emotional state. These are simulation values that drive decisions, speech tone,
 * posture and (with a MetaHuman face rig) expressions — not a claim the NPC feels anything.
 */
UCLASS(ClassGroup = (Neon), meta = (BlueprintSpawnableComponent))
class PROJECTNEON_API UNPCEmotionComponent : public UActorComponent
{
	GENERATED_BODY()
public:
	UPROPERTY(BlueprintReadOnly) float Valence = 0.1f;  // -1 unhappy .. 1 happy
	UPROPERTY(BlueprintReadOnly) float Arousal = 0.2f;  // 0 calm .. 1 agitated
	UPROPERTY(BlueprintReadOnly) float Fear = 0.f;
	UPROPERTY(BlueprintReadOnly) float Anger = 0.f;
	UPROPERTY(BlueprintReadOnly) float Joy = 0.2f;
	UPROPERTY(BlueprintReadOnly) float Stress = 0.1f;

	/** Resting mood set by personality and circumstances (e.g. financial stress). */
	float BaselineValence = 0.1f;
	float BaselineStress = 0.1f;

	void Stimulate(float DValence, float DArousal, float DFear = 0.f, float DAnger = 0.f, float DJoy = 0.f);
	/** Relax toward baseline; Hours = elapsed game hours. */
	void Decay(double Hours);
	FString Describe() const;
};
