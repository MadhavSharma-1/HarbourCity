#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "Core/NeonTypes.h"
#include "NeonNPC.generated.h"

class UNPCIdentityComponent;
class UNPCMemoryComponent;
class UNPCNeedsComponent;
class UNPCEmotionComponent;
class UNPCRelationshipComponent;
class UNPCPerceptionComponent;
class UNPCScheduleComponent;
class UNPCDialogueComponent;
class ANeonVehicle;
class UStaticMeshComponent;
class USkeletalMesh;
class UAnimInstance;

/** A citizen. All state lives in components; the brain is ANPCDecisionController. */
UCLASS()
class PROJECTNEON_API ANeonNPC : public ACharacter
{
	GENERATED_BODY()
public:
	ANeonNPC();

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly) UNPCIdentityComponent* Identity;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly) UNPCMemoryComponent* Memory;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly) UNPCNeedsComponent* Needs;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly) UNPCEmotionComponent* Emotion;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly) UNPCRelationshipComponent* Relationships;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly) UNPCPerceptionComponent* Perception;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly) UNPCScheduleComponent* Schedule;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly) UNPCDialogueComponent* Dialogue;

	/** Placeholder body used when no skeletal mesh (Manny/Quinn/MetaHuman) is available. */
	UPROPERTY(VisibleAnywhere) UStaticMeshComponent* PlaceholderBody;
	UPROPERTY(VisibleAnywhere) UStaticMeshComponent* PlaceholderHead;

	FName GetNpcId() const;
	ENeonActivity CurrentActivity = ENeonActivity::Idle;
	int32 SimTier = 1;
	FName CurrentPlace;

	bool IsIndoors() const { return bIndoors; }
	void SetIndoors(bool bInside, const FVector& ExitLocation = FVector::ZeroVector);

	/** Perception forwards anything this NPC saw/heard. */
	void OnEventSensed(const FNeonWorldEvent& Event, ENeonInfoSource Source, float Distance);
	struct FStimulus { FNeonWorldEvent Event; ENeonInfoSource Source; float Distance; double RealTime; };
	TArray<FStimulus> PendingStimuli;

	/** Physical reaction to being hit by a car. */
	void Knockdown(const FVector& Impulse);
	bool IsKnockedDown() const { return bKnockedDown; }

	/** Economy events. */
	void LoseJob(const FString& Reason);
	void FindJob(FName NewWorkPlace);

	TWeakObjectPtr<ANeonVehicle> OwnedVehicle;

	/** Applies body visuals (skeletal mesh if configured, otherwise placeholder shapes). */
	void ApplyLook();

	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	virtual void Tick(float DeltaSeconds) override;

	/** Optional: a skeletal mesh + animation blueprint for all NPCs (e.g. Manny/Quinn or MetaHumans). */
	UPROPERTY(EditDefaultsOnly, Category = "Neon|Look") TSoftObjectPtr<USkeletalMesh> BodyMeshAsset;
	UPROPERTY(EditDefaultsOnly, Category = "Neon|Look") TSoftClassPtr<UAnimInstance> AnimClass;

private:
	bool bIndoors = false;
	bool bKnockedDown = false;
	float KnockdownTimer = 0.f;
	double LastSimHours = -1.0;
	int32 LastHour = -1;
	float LastSeenCarHealth = 100.f;
	void CheckOwnedCar();
	void OnNewHour(int32 Hour);
};
