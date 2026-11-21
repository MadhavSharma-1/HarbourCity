#pragma once

#include "CoreMinimal.h"
#include "Core/NeonTypes.h"
#include "NeonSaveGame.generated.h"

/** Persistent NPC state (only what can't be rebuilt from the roster). */
USTRUCT()
struct FNeonNPCSave
{
	GENERATED_BODY()
	UPROPERTY() FName NpcId;
	UPROPERTY() FVector Location = FVector::ZeroVector;
	UPROPERTY() bool bIndoors = false;
	UPROPERTY() FName CurrentPlace;
	UPROPERTY() FName WorkPlace;
	UPROPERTY() bool bEmployed = true;
	UPROPERTY() double UnemployedSince = -1.0;
	UPROPERTY() float HourlyWage = 0.f;
	UPROPERTY() float Money = 0.f;
	UPROPERTY() float Energy = 1.f;
	UPROPERTY() float Hunger = 1.f;
	UPROPERTY() float Social = 1.f;
	UPROPERTY() float Fun = 1.f;
	UPROPERTY() float Valence = 0.f;
	UPROPERTY() float Arousal = 0.f;
	UPROPERTY() float Fear = 0.f;
	UPROPERTY() float Anger = 0.f;
	UPROPERTY() float Joy = 0.f;
	UPROPERTY() float Stress = 0.f;
	UPROPERTY() TArray<FNeonMemory> Memories;
	UPROPERTY() TArray<FNeonRelationship> Relationships;
};

USTRUCT()
struct FNeonVehicleSave
{
	GENERATED_BODY()
	UPROPERTY() FName VehicleId;
	UPROPERTY() FVector Location = FVector::ZeroVector;
	UPROPERTY() FRotator Rotation = FRotator::ZeroRotator;
	UPROPERTY() float Fuel = 0.f;
	UPROPERTY() float Health = 100.f;
	UPROPERTY() bool bFrontLightsBroken = false;
};

USTRUCT()
struct FNeonSaveData
{
	GENERATED_BODY()
	UPROPERTY() int32 Version = 1;
	UPROPERTY() double GameHours = 7.0;
	UPROPERTY() FVector PlayerLocation = FVector::ZeroVector;
	UPROPERTY() FRotator PlayerRotation = FRotator::ZeroRotator;
	UPROPERTY() FName PlayerVehicleId;
	UPROPERTY() float PlayerMoney = 0.f;
	UPROPERTY() float Rain = 0.f;
	UPROPERTY() TArray<FNeonNPCSave> NPCs;
	UPROPERTY() TArray<FNeonVehicleSave> Vehicles;
	UPROPERTY() TArray<FNeonPlace> Places;
	UPROPERTY() TArray<FNeonWorldEvent> EmergencyReports;
};

/**
 * JSON save file in Saved/Neon/world.json — human-readable, diffable, and only the state that
 * matters (NPC memories, relationships, money, jobs; vehicle damage and fuel; clock; places).
 * Also mirrors NPC memories to the AI service database when it is running.
 */
namespace NeonSave
{
	PROJECTNEON_API FString SavePath();
	PROJECTNEON_API bool SaveWorld(UWorld* World);
	PROJECTNEON_API bool LoadWorld(UWorld* World);
}
