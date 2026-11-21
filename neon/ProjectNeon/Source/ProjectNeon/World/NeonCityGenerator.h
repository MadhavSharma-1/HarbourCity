#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Core/NeonTypes.h"
#include "NeonCityGenerator.generated.h"

class UInstancedStaticMeshComponent;
class UPointLightComponent;
class UMaterialInstanceDynamic;
class UMaterialInterface;
class UStaticMesh;
class UNeonSimSubsystem;

/**
 * Builds a small district (3x3 blocks) at runtime: roads, kerbs, sidewalks, buildings for every
 * place NPCs use (homes, offices, café, restaurant, shop, clinic, garage, job centre, gas station),
 * a park, street lights and window lights. Registers places + the sidewalk graph with the sim.
 *
 * Everything is made from engine basic shapes so the project needs no content to run.
 * For photorealism, replace building/prop meshes with Nanite assets (Fab / Quixel Megascans /
 * the free City Sample) by assigning the soft mesh slots below in a Blueprint subclass.
 */
UCLASS()
class PROJECTNEON_API ANeonCityGenerator : public AActor
{
	GENERATED_BODY()
public:
	ANeonCityGenerator();

	static constexpr float Cell = 7400.f;     // block (6000) + road (1400), cm
	static constexpr float BlockHalf = 3000.f;
	static constexpr float RoadHalf = 700.f;

	void Build(UNeonSimSubsystem* Sim);
	/** 0 = day, 1 = night: street lights and window glow. */
	void SetNight(float Night);

	/** Optional art overrides (Nanite meshes). Empty = basic shapes. */
	UPROPERTY(EditDefaultsOnly, Category = "Neon|Art") TSoftObjectPtr<UStaticMesh> BuildingMeshOverride;
	UPROPERTY(EditDefaultsOnly, Category = "Neon|Art") TSoftObjectPtr<UStaticMesh> TreeMeshOverride;

	static FVector BlockCenter(int32 I, int32 J) { return FVector((I - 1) * Cell, (J - 1) * Cell, 0.f); }

private:
	UPROPERTY() TArray<UInstancedStaticMeshComponent*> Instancers;
	UPROPERTY() TArray<UPointLightComponent*> StreetLights;
	UPROPERTY() UMaterialInstanceDynamic* WindowGlow;
	UPROPERTY() UMaterialInstanceDynamic* LampGlow;
	UPROPERTY() UStaticMesh* CubeMesh;
	UPROPERTY() UStaticMesh* CylinderMesh;
	UPROPERTY() UStaticMesh* SphereMesh;

	UInstancedStaticMeshComponent* NewISM(const FName& Name, UStaticMesh* Mesh, UMaterialInterface* Mat, const FName& Tag, bool bCollide);
	void Box(UInstancedStaticMeshComponent* ISM, const FVector& Center, const FVector& SizeCm, float Yaw = 0.f);
	FNeonPlace& AddBuilding(UNeonSimSubsystem* Sim, FName Id, const FString& Name, ENeonPlaceType Type, const FVector& Center, const FVector& Size,
		const FLinearColor& Color, const FVector& DoorDir, float Open, float Close, float Price);
	void BuildWaypoints(UNeonSimSubsystem* Sim);

	UInstancedStaticMeshComponent* Windows = nullptr;
	TMap<FLinearColor, UInstancedStaticMeshComponent*> FacadeByColor;
};
