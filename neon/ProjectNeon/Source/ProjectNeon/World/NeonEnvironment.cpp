#include "World/NeonEnvironment.h"
#include "World/NeonCityGenerator.h"
#include "Core/NeonSimSubsystem.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Components/PostProcessComponent.h"

ANeonEnvironment::ANeonEnvironment()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));

	Sun = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("Sun"));
	Sun->SetupAttachment(RootComponent);
	Sun->SetMobility(EComponentMobility::Movable);
	Sun->SetAtmosphereSunLight(true);
	Sun->SetAtmosphereSunLightIndex(0);
	Sun->SetIntensity(10.f);
	Sun->SetLightSourceAngle(0.53f);
	Sun->SetDynamicShadowCascades(4);
	Sun->bUseTemperature = true;

	Moon = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("Moon"));
	Moon->SetupAttachment(RootComponent);
	Moon->SetMobility(EComponentMobility::Movable);
	Moon->SetAtmosphereSunLight(true);
	Moon->SetAtmosphereSunLightIndex(1);
	Moon->SetIntensity(0.f);
	Moon->SetLightColor(FLinearColor(0.6f, 0.7f, 1.f));
	Moon->SetCastShadows(true);

	Atmosphere = CreateDefaultSubobject<USkyAtmosphereComponent>(TEXT("Atmosphere"));
	Atmosphere->SetupAttachment(RootComponent);

	SkyLight = CreateDefaultSubobject<USkyLightComponent>(TEXT("SkyLight"));
	SkyLight->SetupAttachment(RootComponent);
	SkyLight->SetMobility(EComponentMobility::Movable);
	SkyLight->bRealTimeCapture = true;
	SkyLight->SetIntensity(1.f);

	Fog = CreateDefaultSubobject<UExponentialHeightFogComponent>(TEXT("Fog"));
	Fog->SetupAttachment(RootComponent);
	Fog->SetFogDensity(0.012f);
	Fog->SetFogHeightFalloff(0.2f);
	Fog->SetVolumetricFog(true);

	Clouds = CreateDefaultSubobject<UVolumetricCloudComponent>(TEXT("Clouds"));
	Clouds->SetupAttachment(RootComponent);

	PostProcess = CreateDefaultSubobject<UPostProcessComponent>(TEXT("PostProcess"));
	PostProcess->SetupAttachment(RootComponent);
	PostProcess->bUnbound = true;
	FPostProcessSettings& S = PostProcess->Settings;
	S.bOverride_BloomIntensity = true; S.BloomIntensity = 0.6f;
	S.bOverride_VignetteIntensity = true; S.VignetteIntensity = 0.3f;
	S.bOverride_FilmGrainIntensity = true; S.FilmGrainIntensity = 0.04f;
	S.bOverride_AutoExposureMinBrightness = true; S.AutoExposureMinBrightness = -2.f;
	S.bOverride_AutoExposureMaxBrightness = true; S.AutoExposureMaxBrightness = 14.f;
	S.bOverride_SceneFringeIntensity = true; S.SceneFringeIntensity = 0.15f;
	S.bOverride_ColorSaturation = true; S.ColorSaturation = FVector4(1.04f, 1.03f, 1.f, 1.f);
}

void ANeonEnvironment::Tick(float Dt)
{
	Super::Tick(Dt);
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	if (!Sim) return;
	const float H = Sim->HourOfDay();
	// sun rises in the east (+Y) around 06:00, sets in the west around 18:00
	const float Elev = FMath::Sin((H - 6.f) / 12.f * PI) * 62.f;
	const float Azim = 90.f + (H - 6.f) * 15.f;
	Sun->SetWorldRotation(FRotator(-Elev, Azim + 180.f, 0));
	Moon->SetWorldRotation(FRotator(Elev - 10.f, Azim, 0));
	Night = 1.f - FMath::SmoothStep(-6.f, 6.f, Elev);
	Sun->SetIntensity(10.f * FMath::SmoothStep(-4.f, 8.f, Elev) * (1.f - 0.6f * Rain));
	Sun->SetTemperature(FMath::Lerp(3200.f, 6200.f, FMath::SmoothStep(0.f, 25.f, Elev)));
	Moon->SetIntensity(0.25f * Night * (1.f - 0.7f * Rain));
	Fog->SetFogDensity(FMath::Lerp(0.012f, 0.05f, Rain));
	Sim->Wetness = FMath::FInterpTo(Sim->Wetness, Rain, Dt, 0.05f);
	if (ANeonCityGenerator* C = City.Get()) C->SetNight(Night);
}
