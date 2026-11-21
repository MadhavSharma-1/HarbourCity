#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Core/NeonTypes.h"
#include "NPCScheduleComponent.generated.h"

/**
 * A daily routine that *proposes* an activity for each hour. It is not a script: the
 * decision controller weighs it against needs, emotions and events, and the routine
 * itself changes with circumstances (losing a job turns work hours into job hunting).
 * Each day gets a little random jitter so the city never repeats exactly.
 */
UCLASS(ClassGroup = (Neon), meta = (BlueprintSpawnableComponent))
class PROJECTNEON_API UNPCScheduleComponent : public UActorComponent
{
	GENERATED_BODY()
public:
	UPROPERTY() TArray<FNeonScheduleEntry> Routine;

	/** Typical office-style day; Shift (hours) moves everything for early birds / night owls. */
	void BuildDefault(float WakeHour, float WorkStart, float WorkEnd, bool bWeekendWork);
	/** Rewrites the routine after losing or finding a job. */
	void OnEmploymentChanged(bool bEmployed);

	const FNeonScheduleEntry& PlannedAt(float Hour, int32 Day) const;

private:
	static FNeonScheduleEntry E(float H, ENeonActivity A, ENeonPlaceType P) { FNeonScheduleEntry X; X.StartHour = H; X.Activity = A; X.PlaceType = P; return X; }
	float WorkStartHour = 9.f, WorkEndHour = 17.5f, WakeHour = 7.f;
	bool bWorksWeekends = false;
};
