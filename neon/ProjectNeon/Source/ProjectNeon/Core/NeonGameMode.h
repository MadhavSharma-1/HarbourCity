#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "NeonGameMode.generated.h"

/** Builds the district at startup, spawns the vehicles and the ten citizens, restores the save. */
UCLASS()
class PROJECTNEON_API ANeonGameMode : public AGameModeBase
{
	GENERATED_BODY()
public:
	ANeonGameMode();
	virtual void StartPlay() override;
	virtual void RestartPlayer(AController* NewPlayer) override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

	/** Start next to the player's car, on the sidewalk outside Harbor View. */
	FVector PlayerStart = FVector(-7400.f + 2850.f, -7400.f + 1500.f, 150.f);

private:
	FTimerHandle AutosaveTimer;
	FTimerHandle HealthTimer;
};
