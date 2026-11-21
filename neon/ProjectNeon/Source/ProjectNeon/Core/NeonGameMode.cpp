#include "Core/NeonGameMode.h"
#include "Core/NeonSimSubsystem.h"
#include "Core/NeonSaveGame.h"
#include "World/NeonCityGenerator.h"
#include "World/NeonEnvironment.h"
#include "NPC/NeonNPC.h"
#include "NPC/NPCRoster.h"
#include "NPC/NPCIdentityComponent.h"
#include "NPC/NPCNeedsComponent.h"
#include "NPC/NPCEmotionComponent.h"
#include "NPC/NPCDecisionController.h"
#include "NPC/NPCMemoryComponent.h"
#include "Vehicle/NeonVehicle.h"
#include "Player/NeonCharacter.h"
#include "Player/NeonPlayerController.h"
#include "UI/NeonHUD.h"
#include "AI/NeonAIClient.h"
#include "ProjectNeon.h"
#include "EngineUtils.h"
#include "TimerManager.h"
#include "HAL/IConsoleManager.h"

ANeonGameMode::ANeonGameMode()
{
	DefaultPawnClass = ANeonCharacter::StaticClass();
	PlayerControllerClass = ANeonPlayerController::StaticClass();
	HUDClass = ANeonHUD::StaticClass();
}

void ANeonGameMode::StartPlay()
{
	UWorld* World = GetWorld();
	UNeonSimSubsystem* Sim = World->GetSubsystem<UNeonSimSubsystem>();
	FActorSpawnParameters SP;
	SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	ANeonCityGenerator* City = World->SpawnActor<ANeonCityGenerator>(FVector::ZeroVector, FRotator::ZeroRotator, SP);
	City->Build(Sim);
	ANeonEnvironment* Env = World->SpawnActor<ANeonEnvironment>(FVector::ZeroVector, FRotator::ZeroRotator, SP);
	Env->City = City;

	// the player's car, and Marcus's parked hatchback (damage it and he'll notice)
	SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
	if (ANeonVehicle* Mine = World->SpawnActor<ANeonVehicle>(FVector(-7400.f + 3450.f, -7400.f + 1500.f, 120.f), FRotator(0, 90, 0), SP))
	{
		Mine->VehicleId = TEXT("CAR_PLAYER");
		Mine->ColorName = TEXT("black"); Mine->BodyType = TEXT("sports car");
		Mine->SetPaint(FLinearColor(0.012f, 0.012f, 0.014f));
		Mine->Fuel = 18.f;
	}
	if (ANeonVehicle* Marcus = World->SpawnActor<ANeonVehicle>(FVector(-7400.f + 3450.f, 7400.f - 1200.f, 120.f), FRotator(0, -90, 0), SP))
	{
		Marcus->VehicleId = TEXT("CAR_MARCUS");
		Marcus->OwnerNpcId = TEXT("NPC_MARCUS");
		Marcus->ColorName = TEXT("blue"); Marcus->BodyType = TEXT("hatchback");
		Marcus->EnginePowerKW = 95.f; Marcus->MassKg = 1150.f; Marcus->Fuel = 30.f;
		Marcus->SetPaint(FLinearColor(0.05f, 0.12f, 0.45f));
	}

	TArray<ANeonNPC*> NPCs = NeonRoster::SpawnAll(World, Sim);
	for (ANeonNPC* N : NPCs)
		if (N->GetNpcId() == TEXT("NPC_MARCUS"))
			for (TActorIterator<ANeonVehicle> It(World); It; ++It) if (It->OwnerNpcId == N->GetNpcId()) N->OwnedVehicle = *It;

	Super::StartPlay();

	if (NeonSave::LoadWorld(World)) UE_LOG(LogNeon, Log, TEXT("Restored previous session"));
	World->GetTimerManager().SetTimer(AutosaveTimer, FTimerDelegate::CreateWeakLambda(this, [this]() { NeonSave::SaveWorld(GetWorld()); }), 300.f, true);
	World->GetTimerManager().SetTimer(HealthTimer, FTimerDelegate::CreateWeakLambda(this, [this]()
	{
		if (UNeonAIClient* AI = GetGameInstance()->GetSubsystem<UNeonAIClient>()) AI->CheckHealth();
	}), 30.f, true);
}

void ANeonGameMode::RestartPlayer(AController* NewPlayer)
{
	// the empty map has no PlayerStart: spawn at a fixed spot in the district
	RestartPlayerAtTransform(NewPlayer, FTransform(FRotator(0, 0, 0), PlayerStart));
}

void ANeonGameMode::EndPlay(const EEndPlayReason::Type Reason)
{
	NeonSave::SaveWorld(GetWorld());
	Super::EndPlay(Reason);
}

/* ───────────── console commands (open the console with ` and type e.g. Neon.FireNPC Daniel) ───────────── */
namespace
{
	ANeonNPC* FindByName(UWorld* W, const FString& Name)
	{
		UNeonSimSubsystem* Sim = W->GetSubsystem<UNeonSimSubsystem>();
		for (ANeonNPC* N : Sim->GetNPCs())
			if (N->Identity->FirstName.Equals(Name, ESearchCase::IgnoreCase) || N->GetNpcId().ToString().Equals(Name, ESearchCase::IgnoreCase)) return N;
		return nullptr;
	}

	FAutoConsoleCommandWithWorldAndArgs CmdFire(TEXT("Neon.FireNPC"), TEXT("Neon.FireNPC <name> - the NPC loses their job"),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* W)
		{
			if (Args.Num() == 0 || !W) return;
			if (ANeonNPC* N = FindByName(W, Args[0])) N->LoseJob(TEXT("budget cuts"));
		}));
	FAutoConsoleCommandWithWorldAndArgs CmdHire(TEXT("Neon.HireNPC"), TEXT("Neon.HireNPC <name> <PlaceId> - give the NPC a job"),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* W)
		{
			if (Args.Num() < 2 || !W) return;
			if (ANeonNPC* N = FindByName(W, Args[0])) N->FindJob(FName(*Args[1]));
		}));
	FAutoConsoleCommandWithWorldAndArgs CmdTime(TEXT("Neon.Time"), TEXT("Neon.Time <hour> - jump to that hour today"),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* W)
		{
			if (Args.Num() == 0 || !W) return;
			UNeonSimSubsystem* Sim = W->GetSubsystem<UNeonSimSubsystem>();
			Sim->GameHours = NeonTime::Day(Sim->GameHours) * 24.0 + FCString::Atof(*Args[0]);
		}));
	FAutoConsoleCommandWithWorldAndArgs CmdWeather(TEXT("Neon.Weather"), TEXT("Neon.Weather <clear|rain|0..1>"),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* W)
		{
			if (Args.Num() == 0 || !W) return;
			const float R = Args[0] == TEXT("rain") ? 1.f : Args[0] == TEXT("clear") ? 0.f : FMath::Clamp(FCString::Atof(*Args[0]), 0.f, 1.f);
			for (TActorIterator<ANeonEnvironment> It(W); It; ++It) It->Rain = R;
		}));
	FAutoConsoleCommandWithWorldAndArgs CmdCloseShop(TEXT("Neon.SetOperating"), TEXT("Neon.SetOperating <PlaceId> <0|1> - close or reopen a business"),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* W)
		{
			if (Args.Num() < 2 || !W) return;
			if (FNeonPlace* P = W->GetSubsystem<UNeonSimSubsystem>()->FindPlaceMutable(FName(*Args[0]))) P->bOperating = Args[1] != TEXT("0");
		}));
	FAutoConsoleCommandWithWorldAndArgs CmdWho(TEXT("Neon.Who"), TEXT("Neon.Who - log every NPC's state"),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* W)
		{
			if (!W) return;
			for (ANeonNPC* N : W->GetSubsystem<UNeonSimSubsystem>()->GetNPCs())
			{
				const ANPCDecisionController* C = Cast<ANPCDecisionController>(N->GetController());
				UE_LOG(LogNeon, Display, TEXT("%s | tier %d | %s (%s) | %s | $%.0f | employed %d | memories %d"), *N->Identity->FullName(), N->SimTier,
					*NeonTime::ActivityName(N->CurrentActivity), C ? *C->LastReason : TEXT(""), *N->Emotion->Describe(), N->Needs->Money, N->Needs->bEmployed, N->Memory->Memories.Num());
			}
		}));
	FAutoConsoleCommandWithWorld CmdSave(TEXT("Neon.Save"), TEXT("Save the world"), FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* W) { NeonSave::SaveWorld(W); }));
	FAutoConsoleCommandWithWorld CmdLoad(TEXT("Neon.Load"), TEXT("Load the world"), FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* W) { NeonSave::LoadWorld(W); }));
}
