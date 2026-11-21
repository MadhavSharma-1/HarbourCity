#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "NeonEnvironment.generated.h"

class UDirectionalLightComponent;
class USkyAtmosphereComponent;
class USkyLightComponent;
class UExponentialHeightFogComponent;
class UVolumetricCloudComponent;
class UPostProcessComponent;
class ANeonCityGenerator;

/**
 * Physically based sky & lighting driven by the sim clock: sun + moon over a SkyAtmosphere,
 * real-time captured SkyLight (works with Lumen GI/reflections), volumetric clouds,
 * height fog with volumetric fog, and a post-process volume (exposure, bloom, grading).
 * Rain raises fog and road wetness (wetness lowers tyre grip).
 */
UCLASS()
class PROJECTNEON_API ANeonEnvironment : public AActor
{
	GENERATED_BODY()
public:
	ANeonEnvironment();
	virtual void Tick(float DeltaSeconds) override;

	UPROPERTY(VisibleAnywhere) UDirectionalLightComponent* Sun;
	UPROPERTY(VisibleAnywhere) UDirectionalLightComponent* Moon;
	UPROPERTY(VisibleAnywhere) USkyAtmosphereComponent* Atmosphere;
	UPROPERTY(VisibleAnywhere) USkyLightComponent* SkyLight;
	UPROPERTY(VisibleAnywhere) UExponentialHeightFogComponent* Fog;
	UPROPERTY(VisibleAnywhere) UVolumetricCloudComponent* Clouds;
	UPROPERTY(VisibleAnywhere) UPostProcessComponent* PostProcess;

	TWeakObjectPtr<ANeonCityGenerator> City;
	/** 0 = clear, 1 = heavy rain. */
	float Rain = 0.f;
	float Night = 0.f;
};
