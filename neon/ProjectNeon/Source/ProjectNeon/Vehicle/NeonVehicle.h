#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "NeonVehicle.generated.h"

class UBoxComponent;
class USpringArmComponent;
class UCameraComponent;
class USpotLightComponent;
class UPointLightComponent;
class ANeonCharacter;
class UStaticMeshComponent;

/**
 * Drivable car built on a single rigid body with four raycast wheels.
 * Suspension springs + per-wheel friction circles scaled by each wheel's load give weight
 * transfer under braking/cornering for free. Fuel, engine health, lights, crash damage and
 * surface/weather grip are simulated; crashes are published as world events that NPCs perceive.
 * Physically grounded approximations — not a full drivetrain simulation.
 */
UCLASS()
class PROJECTNEON_API ANeonVehicle : public APawn
{
	GENERATED_BODY()
public:
	ANeonVehicle();

	UPROPERTY(VisibleAnywhere) UBoxComponent* Body;
	UPROPERTY(VisibleAnywhere) UStaticMeshComponent* Chassis;
	UPROPERTY(VisibleAnywhere) UStaticMeshComponent* Cabin;
	UPROPERTY(VisibleAnywhere) UStaticMeshComponent* WheelMeshes[4];
	UPROPERTY(VisibleAnywhere) USpotLightComponent* HeadlightL;
	UPROPERTY(VisibleAnywhere) USpotLightComponent* HeadlightR;
	UPROPERTY(VisibleAnywhere) UPointLightComponent* TailLights;
	UPROPERTY(VisibleAnywhere) USpringArmComponent* CameraArm;
	UPROPERTY(VisibleAnywhere) UCameraComponent* Camera;

	/* identity */
	UPROPERTY(EditAnywhere) FName VehicleId;
	UPROPERTY(EditAnywhere) FString ColorName = TEXT("black");
	UPROPERTY(EditAnywhere) FString BodyType = TEXT("sports car");
	UPROPERTY(EditAnywhere) FLinearColor Paint = FLinearColor(0.02f, 0.02f, 0.025f);
	/** NPC who owns this car (none = player's). */
	UPROPERTY(EditAnywhere) FName OwnerNpcId;

	/* tuning */
	UPROPERTY(EditAnywhere, Category = "Neon|Tuning") float MassKg = 1450.f;
	UPROPERTY(EditAnywhere, Category = "Neon|Tuning") float EnginePowerKW = 260.f;
	UPROPERTY(EditAnywhere, Category = "Neon|Tuning") float MaxSteerDeg = 34.f;
	UPROPERTY(EditAnywhere, Category = "Neon|Tuning") float SpringRate = 36000.f;   // per cm of compression
	UPROPERTY(EditAnywhere, Category = "Neon|Tuning") float Damping = 3800.f;       // per cm/s
	UPROPERTY(EditAnywhere, Category = "Neon|Tuning") float RestLength = 32.f;
	UPROPERTY(EditAnywhere, Category = "Neon|Tuning") float WheelRadius = 34.f;
	UPROPERTY(EditAnywhere, Category = "Neon|Tuning") float TyreGrip = 1.05f;

	/* state */
	UPROPERTY(EditAnywhere, Category = "Neon|State") float Fuel = 22.f;        // litres
	UPROPERTY(EditAnywhere, Category = "Neon|State") float FuelCapacity = 55.f;
	UPROPERTY(EditAnywhere, Category = "Neon|State") float Health = 100.f;     // engine/body condition
	UPROPERTY(EditAnywhere, Category = "Neon|State") bool bHeadlights = false;
	UPROPERTY(EditAnywhere, Category = "Neon|State") bool bFrontLightsBroken = false;
	bool bEngineOn = false;

	TWeakObjectPtr<ANeonCharacter> Driver;

	float GetSpeedKmh() const;
	FString GetDescription() const { return ColorName + TEXT(" ") + BodyType; }
	void ApplyDamage(float ImpactSpeedMs, const FVector& WorldPoint);
	void SetPaint(const FLinearColor& C);
	/** At a gas station: fill up, paid from the driver's money. Returns litres added this frame. */
	float Refuel(float DeltaSeconds);
	bool IsAtGasStation() const;

	virtual void Tick(float DeltaSeconds) override;
	virtual void BeginPlay() override;
	virtual void SetupPlayerInputComponent(UInputComponent* Input) override;
	virtual void UnPossessed() override;

private:
	float ThrottleIn = 0.f, SteerIn = 0.f, Steer = 0.f;
	bool bHandbrake = false, bRefuelHeld = false, bBraking = false;
	FVector PrevVelocity = FVector::ZeroVector;
	float LastImpactTime = -10.f;
	float WheelSpin[4] = { 0, 0, 0, 0 };
	float NearMissTimer = 0.f;
	TMap<FName, float> NearMissCooldown;

	void MoveForward(float V) { ThrottleIn = V; }
	void MoveRight(float V) { SteerIn = V; }
	void Turn(float V) { AddControllerYawInput(V); }
	void LookUp(float V) { AddControllerPitchInput(V); }
	void ToggleHeadlights() { bHeadlights = !bHeadlights; }
	void HandbrakeOn() { bHandbrake = true; }
	void HandbrakeOff() { bHandbrake = false; }
	void Horn();
	void RefuelOn() { bRefuelHeld = true; }
	void RefuelOff() { bRefuelHeld = false; }

	void SimulateWheels(float Dt);
	void UpdateLights();
	void CheckNearMisses(float Dt);

	UFUNCTION() void OnBodyHit(UPrimitiveComponent* HitComp, AActor* OtherActor, UPrimitiveComponent* OtherComp, FVector NormalImpulse, const FHitResult& Hit);
};
