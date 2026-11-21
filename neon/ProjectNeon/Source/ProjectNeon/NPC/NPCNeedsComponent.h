#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Core/NeonTypes.h"
#include "NPCNeedsComponent.generated.h"

/** Physical/social needs and personal finances. Values are 0 (urgent) .. 1 (satisfied). */
UCLASS(ClassGroup = (Neon), meta = (BlueprintSpawnableComponent))
class PROJECTNEON_API UNPCNeedsComponent : public UActorComponent
{
	GENERATED_BODY()
public:
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Energy = 0.9f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Hunger = 0.8f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Social = 0.6f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Fun = 0.6f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Money = 800.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float HourlyWage = 25.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float DailyRent = 45.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool bEmployed = true;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) double UnemployedSince = -1.0;

	/** 0 = comfortable, 1 = can't pay rent. Derived from savings vs. outgoings and job status. */
	float FinancialStress() const
	{
		const float DaysOfRent = Money / FMath::Max(DailyRent, 1.f);
		const float S = FMath::Clamp(1.f - DaysOfRent / 20.f, 0.f, 1.f);
		return FMath::Clamp(S + (bEmployed ? 0.f : 0.35f), 0.f, 1.f);
	}
	/** Spending appetite: drops sharply with financial stress. */
	bool CanAfford(float Price) const { return Money - Price > DailyRent * (2.f + 6.f * FinancialStress()); }

	/** Advance needs by game hours for the current activity. Returns money earned/spent this step. */
	float Simulate(double Hours, ENeonActivity Activity);
	void PayRent() { Money -= DailyRent; }
	bool Spend(float Amount) { if (Money < Amount) return false; Money -= Amount; return true; }
};
