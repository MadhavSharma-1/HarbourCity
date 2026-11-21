#include "Core/NeonSaveGame.h"
#include "Core/NeonSimSubsystem.h"
#include "NPC/NeonNPC.h"
#include "NPC/NPCIdentityComponent.h"
#include "NPC/NPCNeedsComponent.h"
#include "NPC/NPCEmotionComponent.h"
#include "NPC/NPCMemoryComponent.h"
#include "NPC/NPCRelationshipComponent.h"
#include "NPC/NPCScheduleComponent.h"
#include "Vehicle/NeonVehicle.h"
#include "Player/NeonCharacter.h"
#include "Player/NeonPlayerController.h"
#include "World/NeonEnvironment.h"
#include "AI/NeonAIClient.h"
#include "ProjectNeon.h"
#include "EngineUtils.h"
#include "JsonObjectConverter.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Dom/JsonObject.h"
#include "Kismet/GameplayStatics.h"

FString NeonSave::SavePath() { return FPaths::ProjectSavedDir() / TEXT("Neon") / TEXT("world.json"); }

bool NeonSave::SaveWorld(UWorld* World)
{
	UNeonSimSubsystem* Sim = World ? World->GetSubsystem<UNeonSimSubsystem>() : nullptr;
	if (!Sim) return false;
	FNeonSaveData D;
	D.GameHours = Sim->GameHours;
	D.Places = Sim->Places;
	D.EmergencyReports = Sim->EmergencyReports;
	for (TActorIterator<ANeonEnvironment> It(World); It; ++It) D.Rain = It->Rain;
	APlayerController* PC = UGameplayStatics::GetPlayerController(World, 0);
	if (APawn* P = PC ? PC->GetPawn() : nullptr)
	{
		D.PlayerLocation = P->GetActorLocation();
		D.PlayerRotation = P->GetActorRotation();
		if (const ANeonVehicle* V = Cast<ANeonVehicle>(P)) D.PlayerVehicleId = V->VehicleId;
	}
	const ANeonPlayerController* NPC_PC = Cast<ANeonPlayerController>(PC);
	const ANeonCharacter* Me = NPC_PC ? NPC_PC->GetOnFootCharacter() : nullptr;
	if (!Me && PC) Me = Cast<ANeonCharacter>(PC->GetPawn());
	if (Me) D.PlayerMoney = Me->Money;

	TArray<TSharedPtr<FJsonValue>> AllMemories;
	for (ANeonNPC* N : Sim->GetNPCs())
	{
		FNeonNPCSave& S = D.NPCs.AddDefaulted_GetRef();
		S.NpcId = N->GetNpcId(); S.Location = N->GetActorLocation(); S.bIndoors = N->IsIndoors(); S.CurrentPlace = N->CurrentPlace;
		S.WorkPlace = N->Identity->WorkPlace; S.bEmployed = N->Needs->bEmployed; S.UnemployedSince = N->Needs->UnemployedSince; S.HourlyWage = N->Needs->HourlyWage;
		S.Money = N->Needs->Money; S.Energy = N->Needs->Energy; S.Hunger = N->Needs->Hunger; S.Social = N->Needs->Social; S.Fun = N->Needs->Fun;
		S.Valence = N->Emotion->Valence; S.Arousal = N->Emotion->Arousal; S.Fear = N->Emotion->Fear; S.Anger = N->Emotion->Anger; S.Joy = N->Emotion->Joy; S.Stress = N->Emotion->Stress;
		S.Memories = N->Memory->Memories.FilterByPredicate([](const FNeonMemory& M) { return M.Tier != ENeonMemoryTier::Working; });
		S.Relationships = N->Relationships->Relationships;
		AllMemories.Append(N->Memory->ToJson());
	}
	for (TActorIterator<ANeonVehicle> It(World); It; ++It)
	{
		FNeonVehicleSave& V = D.Vehicles.AddDefaulted_GetRef();
		V.VehicleId = It->VehicleId; V.Location = It->GetActorLocation(); V.Rotation = It->GetActorRotation();
		V.Fuel = It->Fuel; V.Health = It->Health; V.bFrontLightsBroken = It->bFrontLightsBroken;
	}
	FString Json;
	if (!FJsonObjectConverter::UStructToJsonObjectString(D, Json)) return false;
	if (!FFileHelper::SaveStringToFile(Json, *SavePath())) return false;
	UE_LOG(LogNeon, Log, TEXT("Saved world to %s (%d NPCs)"), *SavePath(), D.NPCs.Num());

	// optional: mirror memories into the AI service's SQLite store for inspection/analysis
	if (UNeonAIClient* AI = World->GetGameInstance()->GetSubsystem<UNeonAIClient>())
	{
		TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
		Body->SetArrayField(TEXT("memories"), AllMemories);
		AI->Post(TEXT("/v1/memory/sync"), Body, false, [](bool, TSharedPtr<FJsonObject>) {});
	}
	return true;
}

bool NeonSave::LoadWorld(UWorld* World)
{
	UNeonSimSubsystem* Sim = World ? World->GetSubsystem<UNeonSimSubsystem>() : nullptr;
	FString Json;
	if (!Sim || !FFileHelper::LoadFileToString(Json, *SavePath())) return false;
	FNeonSaveData D;
	if (!FJsonObjectConverter::JsonObjectStringToUStruct(Json, &D, 0, 0))
	{
		UE_LOG(LogNeon, Warning, TEXT("Save file is corrupt: %s"), *SavePath());
		return false;
	}
	Sim->GameHours = D.GameHours;
	for (const FNeonPlace& P : D.Places) if (FNeonPlace* Live = Sim->FindPlaceMutable(P.Id)) { Live->bOperating = P.bOperating; Live->DailyRevenue = P.DailyRevenue; Live->Price = P.Price; }
	Sim->EmergencyReports = D.EmergencyReports;
	for (TActorIterator<ANeonEnvironment> It(World); It; ++It) It->Rain = D.Rain;
	for (const FNeonNPCSave& S : D.NPCs)
	{
		ANeonNPC* N = Sim->FindNPC(S.NpcId);
		if (!N) continue;
		N->SetIndoors(false);
		N->SetActorLocation(S.Location, false, nullptr, ETeleportType::TeleportPhysics);
		const bool bJobChanged = N->Needs->bEmployed != S.bEmployed;
		N->Identity->WorkPlace = S.WorkPlace; N->Needs->bEmployed = S.bEmployed; N->Needs->UnemployedSince = S.UnemployedSince; N->Needs->HourlyWage = S.HourlyWage;
		N->Needs->Money = S.Money; N->Needs->Energy = S.Energy; N->Needs->Hunger = S.Hunger; N->Needs->Social = S.Social; N->Needs->Fun = S.Fun;
		N->Emotion->Valence = S.Valence; N->Emotion->Arousal = S.Arousal; N->Emotion->Fear = S.Fear; N->Emotion->Anger = S.Anger; N->Emotion->Joy = S.Joy; N->Emotion->Stress = S.Stress;
		N->Memory->Memories = S.Memories;
		N->Relationships->Relationships = S.Relationships;
		if (bJobChanged) N->Schedule->OnEmploymentChanged(S.bEmployed);
		if (S.bIndoors) { N->CurrentPlace = S.CurrentPlace; N->SetIndoors(true); }
	}
	for (TActorIterator<ANeonVehicle> It(World); It; ++It)
		for (const FNeonVehicleSave& V : D.Vehicles)
			if (V.VehicleId == It->VehicleId)
			{
				It->SetActorLocationAndRotation(V.Location + FVector(0, 0, 30), V.Rotation, false, nullptr, ETeleportType::ResetPhysics);
				It->Fuel = V.Fuel; It->Health = V.Health; It->bFrontLightsBroken = V.bFrontLightsBroken;
			}
	APlayerController* PC = UGameplayStatics::GetPlayerController(World, 0);
	ANeonPlayerController* NPC_PC = Cast<ANeonPlayerController>(PC);
	ANeonCharacter* Me = NPC_PC ? NPC_PC->GetOnFootCharacter() : nullptr;
	if (!Me && PC) Me = Cast<ANeonCharacter>(PC->GetPawn());
	if (Me) Me->Money = D.PlayerMoney;
	if (PC && PC->GetPawn() && D.PlayerVehicleId.IsNone() && Cast<ANeonCharacter>(PC->GetPawn()))
		PC->GetPawn()->SetActorLocationAndRotation(D.PlayerLocation + FVector(0, 0, 20), D.PlayerRotation, false, nullptr, ETeleportType::TeleportPhysics);
	UE_LOG(LogNeon, Log, TEXT("Loaded world from %s"), *SavePath());
	return true;
}
