#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Core/NeonTypes.h"
#include "NPCIdentityComponent.generated.h"

/** Who this person is: identity, background, job, home and personality traits. */
UCLASS(ClassGroup = (Neon), meta = (BlueprintSpawnableComponent))
class PROJECTNEON_API UNPCIdentityComponent : public UActorComponent
{
	GENERATED_BODY()
public:
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FName NpcId;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString FirstName;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString LastName;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 Age = 30;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool bFemale = false;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Occupation;
	/** Place id of the employer (empty = unemployed). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FName WorkPlace;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FName HomePlace;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Backstory;
	/** How other people would describe them ("tall man in a grey suit"). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Appearance;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FLinearColor ClothingColor = FLinearColor::Gray;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FNeonPersonality Personality;

	FString FullName() const { return FirstName + TEXT(" ") + LastName; }
};
