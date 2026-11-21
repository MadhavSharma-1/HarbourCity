#include "UI/NeonHUD.h"
#include "Player/NeonPlayerController.h"
#include "Player/NeonCharacter.h"
#include "Vehicle/NeonVehicle.h"
#include "NPC/NeonNPC.h"
#include "NPC/NPCIdentityComponent.h"
#include "NPC/NPCEmotionComponent.h"
#include "NPC/NPCNeedsComponent.h"
#include "NPC/NPCMemoryComponent.h"
#include "NPC/NPCDialogueComponent.h"
#include "NPC/NPCRelationshipComponent.h"
#include "NPC/NPCDecisionController.h"
#include "Core/NeonSimSubsystem.h"
#include "AI/NeonAIClient.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"

void ANeonHUD::Text(const FString& S, float X, float Y, const FLinearColor& C, float Scale, bool bBox, bool bCenter)
{
	UFont* F = GEngine->GetMediumFont();
	float W = 0, H = 0;
	GetTextSize(S, W, H, F, Scale);
	if (bCenter) X -= W * 0.5f;
	if (bBox) DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.55f), X - 8, Y - 4, W + 16, H + 8);
	DrawText(S, C, X, Y, F, Scale);
}

void ANeonHUD::DrawHUD()
{
	Super::DrawHUD();
	if (!Canvas) return;
	const float W = Canvas->ClipX, H = Canvas->ClipY;
	const float UI = FMath::Clamp(H / 1080.f, 0.8f, 2.f);
	ANeonPlayerController* PC = Cast<ANeonPlayerController>(GetOwningPlayerController());
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	if (!PC || !Sim) return;

	// clock, money, AI status
	Text(Sim->Clock(), W - 230 * UI, 24 * UI, FLinearColor::White, 1.6f * UI, true);
	const ANeonCharacter* Me = PC->GetOnFootCharacter();
	if (!Me) Me = Cast<ANeonCharacter>(PC->GetPawn());
	if (Me) Text(FString::Printf(TEXT("$%.0f"), Me->Money), W - 230 * UI, 70 * UI, FLinearColor(0.55f, 1.f, 0.6f), 1.3f * UI, true);
	const UNeonAIClient* AI = GetGameInstance()->GetSubsystem<UNeonAIClient>();
	const bool bModel = AI && AI->IsAvailable() && AI->GetProviderName() != TEXT("rules");
	Text(bModel ? FString::Printf(TEXT("NPC dialogue: %s"), *AI->GetProviderName()) : FString(TEXT("NPC dialogue: offline rules")), W - 230 * UI, 108 * UI, FLinearColor(0.7f, 0.75f, 0.8f), 0.8f * UI);

	// vehicle gauges
	if (const ANeonVehicle* V = Cast<ANeonVehicle>(PC->GetPawn()))
	{
		const float X = W - 300 * UI, Y = H - 190 * UI;
		DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.55f), X - 14, Y - 10, 290 * UI, 170 * UI);
		Text(FString::Printf(TEXT("%d km/h"), FMath::RoundToInt(V->GetSpeedKmh())), X, Y, FLinearColor::White, 2.2f * UI);
		Text(FString::Printf(TEXT("Fuel  %.1f / %.0f L"), V->Fuel, V->FuelCapacity), X, Y + 62 * UI, V->Fuel < 6.f ? FLinearColor(1.f, 0.45f, 0.3f) : FLinearColor(1.f, 0.85f, 0.45f), UI);
		Text(FString::Printf(TEXT("Engine %d%%"), FMath::RoundToInt(V->Health)), X, Y + 88 * UI, V->Health < 40.f ? FLinearColor(1.f, 0.35f, 0.3f) : FLinearColor(0.6f, 1.f, 0.65f), UI);
		Text(FString::Printf(TEXT("Lights %s%s"), V->bHeadlights ? TEXT("ON") : TEXT("off"), V->bFrontLightsBroken ? TEXT(" (broken)") : TEXT("")), X, Y + 114 * UI, FLinearColor(0.8f, 0.85f, 0.9f), UI);
		if (Sim->Wetness > 0.2f) Text(TEXT("Wet road - less grip"), X, Y + 140 * UI, FLinearColor(0.5f, 0.8f, 1.f), 0.85f * UI);
	}

	DrawBubbles();
	if (!PC->Prompt.IsEmpty()) Text(PC->Prompt, W * 0.5f, H - 120 * UI, FLinearColor::White, 1.1f * UI, true, true);
	for (int32 i = 0; i < PC->Notifications.Num(); ++i) Text(PC->Notifications[i].Key, W * 0.5f, (30 + i * 36) * UI, FLinearColor(1.f, 0.9f, 0.7f), 1.f * UI, true, true);
	if (PC->bDebugOverlay) DrawDebug();
	else Text(TEXT("N: simulation overlay   E: talk   F: car   T: skip time   K/F5: save   O/F9: load"), 20 * UI, H - 34 * UI, FLinearColor(0.7f, 0.7f, 0.7f, 0.8f), 0.75f * UI);
}

void ANeonHUD::DrawBubbles()
{
	APlayerController* PC = GetOwningPlayerController();
	const APawn* P = PC->GetPawn();
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	if (!P) return;
	for (ANeonNPC* N : Sim->GetNPCs())
	{
		if (N->IsIndoors() || N->Dialogue->CurrentLine.IsEmpty()) continue;
		if (FVector::Dist(N->GetActorLocation(), P->GetActorLocation()) > 2800.f) continue;
		FVector2D S;
		if (!PC->ProjectWorldLocationToScreen(N->GetActorLocation() + FVector(0, 0, 120), S)) continue;
		Text(FString::Printf(TEXT("%s: %s"), *N->Identity->FirstName, *N->Dialogue->CurrentLine), S.X, S.Y, FLinearColor(1.f, 1.f, 0.95f), 0.85f, true, true);
	}
}

void ANeonHUD::DrawDebug()
{
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	float Y = 24.f;
	Text(TEXT("SIMULATION   name | tier | activity (why) | mood | needs E/H/S | money | memories"), 20, Y, FLinearColor(1.f, 0.75f, 0.3f), 0.85f, true);
	Y += 30.f;
	for (ANeonNPC* N : Sim->GetNPCs())
	{
		const ANPCDecisionController* C = Cast<ANPCDecisionController>(N->GetController());
		const FString Why = C ? C->LastReason : FString();
		FString Top;
		const TArray<FNeonMemory> Recent = N->Memory->Recall(FString(), 1);
		if (Recent.Num()) Top = Recent[0].Summary.Left(70);
		const FString Line = FString::Printf(TEXT("%-16s T%d  %-22s (%s)  %-10s  %.1f/%.1f/%.1f  $%.0f%s  %d  | %s"),
			*N->Identity->FullName(), N->SimTier, *NeonTime::ActivityName(N->CurrentActivity), *Why, *N->Emotion->Describe(),
			N->Needs->Energy, N->Needs->Hunger, N->Needs->Social, N->Needs->Money, N->Needs->bEmployed ? TEXT("") : TEXT(" UNEMPLOYED"),
			N->Memory->Memories.Num(), *Top);
		Text(Line, 20, Y, N->IsIndoors() ? FLinearColor(0.6f, 0.6f, 0.65f) : FLinearColor::White, 0.72f, true);
		Y += 22.f;
	}
	Y += 10.f;
	Text(FString::Printf(TEXT("Events published: %d   Emergency calls: %d   Wetness: %.1f"), Sim->EventHistory.Num(), Sim->EmergencyReports.Num(), Sim->Wetness), 20, Y, FLinearColor(0.7f, 0.9f, 1.f), 0.8f, true);
	Y += 24.f;
	for (int32 i = FMath::Max(0, Sim->EventHistory.Num() - 5); i < Sim->EventHistory.Num(); ++i, Y += 20.f)
		Text(FString::Printf(TEXT("%s  %s"), *NeonTime::Clock(Sim->EventHistory[i].GameTime), *Sim->EventHistory[i].Description), 20, Y, FLinearColor(0.8f, 0.8f, 0.8f), 0.7f);
	Y += 8.f;
	for (const FNeonPlace& P : Sim->Places)
		if (P.DailyRevenue > 0.f) { Text(FString::Printf(TEXT("%s revenue today: $%.0f"), *P.DisplayName, P.DailyRevenue), 20, Y, FLinearColor(0.6f, 1.f, 0.7f), 0.7f); Y += 18.f; }
}
