#include "Player/NeonPlayerController.h"
#include "Player/NeonCharacter.h"
#include "NPC/NeonNPC.h"
#include "NPC/NPCIdentityComponent.h"
#include "NPC/NPCEmotionComponent.h"
#include "NPC/NPCRelationshipComponent.h"
#include "NPC/NPCDialogueComponent.h"
#include "Vehicle/NeonVehicle.h"
#include "Core/NeonSimSubsystem.h"
#include "Core/NeonSaveGame.h"
#include "AI/NeonAIClient.h"
#include "Components/CapsuleComponent.h"
#include "Components/InputComponent.h"
#include "Engine/GameViewportClient.h"
#include "Engine/Engine.h"
#include "Framework/Application/SlateApplication.h"
#include "Styling/CoreStyle.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "EngineUtils.h"

void ANeonPlayerController::SetupInputComponent()
{
	Super::SetupInputComponent();
	InputComponent->BindAction(TEXT("Interact"), IE_Pressed, this, &ANeonPlayerController::Interact);
	InputComponent->BindAction(TEXT("EnterExit"), IE_Pressed, this, &ANeonPlayerController::EnterExit);
	InputComponent->BindAction(TEXT("QuickSave"), IE_Pressed, this, &ANeonPlayerController::QuickSave);
	InputComponent->BindAction(TEXT("QuickLoad"), IE_Pressed, this, &ANeonPlayerController::QuickLoad);
	InputComponent->BindAction(TEXT("TimeSkip"), IE_Pressed, this, &ANeonPlayerController::TimeSkipOn);
	InputComponent->BindAction(TEXT("TimeSkip"), IE_Released, this, &ANeonPlayerController::TimeSkipOff);
	InputComponent->BindAction(TEXT("ToggleDebug"), IE_Pressed, this, &ANeonPlayerController::ToggleDebug);
}

void ANeonPlayerController::Notify(const FString& Text, float Seconds)
{
	Notifications.Emplace(Text, Seconds);
	if (Notifications.Num() > 5) Notifications.RemoveAt(0);
}

void ANeonPlayerController::PlayerTick(float Dt)
{
	Super::PlayerTick(Dt);
	for (int32 i = Notifications.Num() - 1; i >= 0; --i) if ((Notifications[i].Value -= Dt) <= 0.f) Notifications.RemoveAt(i);
	if (CloseTimer > 0.f && (CloseTimer -= Dt) <= 0.f) CloseDialogue();
	if (ANeonCharacter* C = Cast<ANeonCharacter>(GetPawn())) OnFoot = C;

	// context prompt
	Prompt.Reset();
	if (IsTalking()) return;
	if (ANeonVehicle* V = Cast<ANeonVehicle>(GetPawn()))
	{
		if (V->IsAtGasStation() && V->Fuel < V->FuelCapacity - 0.1f) Prompt = TEXT("Hold R  Refuel ($1.79 / litre)");
		else if (V->Health <= 0.f) Prompt = TEXT("F  Get out - the engine is wrecked");
		else if (V->Fuel <= 0.f) Prompt = TEXT("Out of fuel - F to get out");
		return;
	}
	if (ANeonNPC* N = FindTalkTarget()) Prompt = FString::Printf(TEXT("E  Talk to %s"), *N->Identity->FirstName);
	else if (ANeonVehicle* V = FindVehicle()) Prompt = FString::Printf(TEXT("F  Get in the %s"), *V->GetDescription());
}

ANeonNPC* ANeonPlayerController::FindTalkTarget() const
{
	const APawn* P = GetPawn();
	if (!P || !Cast<ANeonCharacter>(P)) return nullptr;
	ANeonNPC* Best = nullptr; float BestD = 260.f;
	for (TActorIterator<ANeonNPC> It(GetWorld()); It; ++It)
	{
		if (It->IsIndoors() || It->IsKnockedDown()) continue;
		const float D = FVector::Dist(It->GetActorLocation(), P->GetActorLocation());
		if (D < BestD) { BestD = D; Best = *It; }
	}
	return Best;
}

ANeonVehicle* ANeonPlayerController::FindVehicle() const
{
	const APawn* P = GetPawn();
	if (!P) return nullptr;
	ANeonVehicle* Best = nullptr; float BestD = 450.f;
	for (TActorIterator<ANeonVehicle> It(GetWorld()); It; ++It)
	{
		const float D = FVector::Dist(It->GetActorLocation(), P->GetActorLocation());
		if (D < BestD) { BestD = D; Best = *It; }
	}
	return Best;
}

void ANeonPlayerController::Interact()
{
	if (IsTalking()) return;
	if (ANeonNPC* N = FindTalkTarget()) OpenDialogue(N);
}

void ANeonPlayerController::EnterExit()
{
	if (IsTalking()) return;
	if (ANeonVehicle* V = Cast<ANeonVehicle>(GetPawn()))
	{
		ANeonCharacter* C = OnFoot.Get();
		if (!C) return;
		if (V->GetSpeedKmh() > 12.f) { Notify(TEXT("Slow down before getting out.")); return; }
		const FVector Out = V->GetActorLocation() - V->GetActorRightVector() * 220.f + FVector(0, 0, 60);
		C->SetActorLocation(Out, false, nullptr, ETeleportType::TeleportPhysics);
		C->SetActorHiddenInGame(false);
		C->SetActorEnableCollision(true);
		V->Driver.Reset();
		Possess(C);
		return;
	}
	ANeonCharacter* C = Cast<ANeonCharacter>(GetPawn());
	ANeonVehicle* V = FindVehicle();
	if (!C || !V) return;
	if (!V->OwnerNpcId.IsNone()) Notify(TEXT("This isn't your car. People will notice."));
	OnFoot = C;
	C->SetActorHiddenInGame(true);
	C->SetActorEnableCollision(false);
	V->Driver = C;
	Possess(V);
	if (V->Fuel <= 0.f) Notify(TEXT("The tank is empty."));
}

void ANeonPlayerController::QuickSave()
{
	if (NeonSave::SaveWorld(GetWorld())) Notify(TEXT("Game saved"));
	else Notify(TEXT("Save failed - see the Output Log"));
}

void ANeonPlayerController::QuickLoad()
{
	if (IsTalking()) CloseDialogue();
	if (NeonSave::LoadWorld(GetWorld())) Notify(TEXT("Game loaded"));
	else Notify(TEXT("No save found"));
}

void ANeonPlayerController::TimeSkipOn()
{
	if (UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>()) Sim->TimeSkipMultiplier = 30.f;
}
void ANeonPlayerController::TimeSkipOff()
{
	if (UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>()) Sim->TimeSkipMultiplier = 1.f;
}

void ANeonPlayerController::OpenDialogue(ANeonNPC* NPC)
{
	if (!NPC || !GEngine || !GEngine->GameViewport) return;
	ActiveNPC = NPC;
	CloseTimer = -1.f;
	NPC->Dialogue->BeginConversation();
	Transcript = FString::Printf(TEXT("(You walk up to %s.)\n"), *NPC->Identity->FirstName);
	TWeakObjectPtr<ANeonPlayerController> Weak(this);
	const UNeonAIClient* AI = GetGameInstance()->GetSubsystem<UNeonAIClient>();
	const FString Brain = AI && AI->IsAvailable() && AI->GetProviderName() != TEXT("rules") ? FString::Printf(TEXT("AI: %s"), *AI->GetProviderName()) : TEXT("AI: offline rules");

	SAssignNew(DialogueRoot, SBox).HAlign(HAlign_Center).VAlign(VAlign_Bottom).Padding(FMargin(0, 0, 0, 40))
	[
		SNew(SBox).WidthOverride(780.f)
		[
			SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush")).BorderBackgroundColor(FLinearColor(0.015f, 0.02f, 0.03f, 0.88f)).Padding(FMargin(20.f))
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(STextBlock).Font(FCoreStyle::GetDefaultFontStyle("Bold", 18)).ColorAndOpacity(FLinearColor(1.f, 0.7f, 0.28f))
					.Text_Lambda([Weak]() { return FText::FromString(Weak.IsValid() && Weak->ActiveNPC.IsValid() ? Weak->ActiveNPC->Identity->FullName() : FString()); })
				]
				+ SVerticalBox::Slot().AutoHeight().Padding(0, 2, 0, 8)
				[
					SNew(STextBlock).Font(FCoreStyle::GetDefaultFontStyle("Regular", 11)).ColorAndOpacity(FLinearColor(0.65f, 0.68f, 0.72f))
					.Text_Lambda([Weak, Brain]()
					{
						if (!Weak.IsValid() || !Weak->ActiveNPC.IsValid()) return FText::GetEmpty();
						const ANeonNPC* N = Weak->ActiveNPC.Get();
						return FText::FromString(FString::Printf(TEXT("%d - %s - feels %s - %s toward you - %s"), N->Identity->Age, *N->Identity->Occupation,
							*N->Emotion->Describe(), *N->Relationships->Label(NeonNames::Player), *Brain));
					})
				]
				+ SVerticalBox::Slot().AutoHeight().MaxHeight(280.f)
				[
					SNew(SScrollBox)
					+ SScrollBox::Slot()
					[
						SNew(STextBlock).AutoWrapText(true).Font(FCoreStyle::GetDefaultFontStyle("Regular", 14)).ColorAndOpacity(FLinearColor::White)
						.Text_Lambda([Weak]() { return FText::FromString(Weak.IsValid() ? Weak->Transcript : FString()); })
					]
				]
				+ SVerticalBox::Slot().AutoHeight().Padding(0, 12, 0, 0)
				[
					SAssignNew(InputBox, SEditableTextBox)
					.Font(FCoreStyle::GetDefaultFontStyle("Regular", 14))
					.HintText(FText::FromString(TEXT("Say anything... (Enter to speak, Esc to walk away)")))
					.ClearKeyboardFocusOnCommit(false)
					.OnTextCommitted_Lambda([Weak](const FText& Text, ETextCommit::Type Type)
					{
						if (!Weak.IsValid()) return;
						if (Type == ETextCommit::OnCleared) { Weak->CloseDialogue(); return; }
						if (Type == ETextCommit::OnEnter) Weak->SubmitLine(Text.ToString());
					})
				]
			]
		]
	];
	GEngine->GameViewport->AddViewportWidgetContent(DialogueRoot.ToSharedRef(), 50);
	FInputModeUIOnly Mode;
	Mode.SetWidgetToFocus(InputBox);
	SetInputMode(Mode);
	bShowMouseCursor = true;
	FSlateApplication::Get().SetKeyboardFocus(InputBox);
}

void ANeonPlayerController::SubmitLine(const FString& Text)
{
	ANeonNPC* NPC = ActiveNPC.Get();
	const FString Clean = Text.TrimStartAndEnd();
	if (!NPC || Clean.IsEmpty() || NPC->Dialogue->bAwaitingReply) return;
	InputBox->SetText(FText::GetEmpty());
	Transcript += FString::Printf(TEXT("\nYou: %s\n%s is thinking...\n"), *Clean, *NPC->Identity->FirstName);
	TWeakObjectPtr<ANeonPlayerController> Weak(this);
	const FString Name = NPC->Identity->FirstName;
	NPC->Dialogue->HandlePlayerLine(Clean, [Weak, Name](const FNeonDialogueResult& R)
	{
		if (!Weak.IsValid()) return;
		Weak->Transcript.ReplaceInline(*FString::Printf(TEXT("%s is thinking...\n"), *Name), TEXT(""));
		Weak->Transcript += FString::Printf(TEXT("%s: %s\n"), *Name, *R.Reply);
		if (R.EndsConversation()) Weak->CloseTimer = 2.5f;
	});
}

void ANeonPlayerController::CloseDialogue()
{
	CloseTimer = -1.f;
	if (ANeonNPC* N = ActiveNPC.Get()) N->Dialogue->EndConversation();
	ActiveNPC.Reset();
	if (DialogueRoot.IsValid() && GEngine && GEngine->GameViewport) GEngine->GameViewport->RemoveViewportWidgetContent(DialogueRoot.ToSharedRef());
	DialogueRoot.Reset();
	InputBox.Reset();
	SetInputMode(FInputModeGameOnly());
	bShowMouseCursor = false;
}

void ANeonPlayerController::EndPlay(const EEndPlayReason::Type Reason)
{
	if (IsTalking()) CloseDialogue();
	Super::EndPlay(Reason);
}
