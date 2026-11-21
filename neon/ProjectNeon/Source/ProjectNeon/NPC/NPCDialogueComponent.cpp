#include "NPC/NPCDialogueComponent.h"
#include "NPC/NeonNPC.h"
#include "NPC/NPCIdentityComponent.h"
#include "NPC/NPCEmotionComponent.h"
#include "NPC/NPCNeedsComponent.h"
#include "NPC/NPCMemoryComponent.h"
#include "NPC/NPCRelationshipComponent.h"
#include "AI/NeonRuleDialogue.h"
#include "AI/NeonMemoryLogic.h"
#include "Core/NeonSimSubsystem.h"
#include "Player/NeonCharacter.h"
#include "Kismet/GameplayStatics.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"

UNPCDialogueComponent::UNPCDialogueComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
}

void UNPCDialogueComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	if (LineTimeLeft > 0.f && (LineTimeLeft -= DeltaTime) <= 0.f) CurrentLine.Reset();
}

void UNPCDialogueComponent::Say(const FString& Text, float Seconds)
{
	CurrentLine = Text;
	LineTimeLeft = FMath::Max(Seconds, 1.5f + Text.Len() * 0.05f);
}

void UNPCDialogueComponent::BeginConversation()
{
	bInConversation = true;
	History.Reset();
}

void UNPCDialogueComponent::EndConversation()
{
	bInConversation = false;
	bAwaitingReply = false;
	ANeonNPC* NPC = Cast<ANeonNPC>(GetOwner());
	if (NPC && History.Num() > 1)
	{
		// one episodic memory for the whole conversation
		FString Topic = History[0].Value.Left(80);
		UNPCMemoryComponent::FParams P;
		P.Type = ENeonEventType::Conversation;
		P.Summary = FString::Printf(TEXT("Talked with the player (%d exchanges). They opened with: \"%s\""), History.Num() / 2, *Topic);
		P.Tags = NeonMemoryLogic::Tokenize(Topic); P.Tags.Add(TEXT("player")); P.Tags.Add(TEXT("conversation"));
		P.Importance = 0.35f + FMath::Abs(NPC->Relationships->Get(NeonNames::Player).Affinity) * 0.3f;
		P.Participants = { NeonNames::Player };
		P.Source = ENeonInfoSource::Conversation;
		P.Tier = ENeonMemoryTier::Episodic;
		NPC->Memory->Remember(P);
	}
}

TSharedRef<FJsonObject> UNPCDialogueComponent::BuildRequest(const FString& Text, const TArray<FNeonMemory>& Recalled) const
{
	const ANeonNPC* NPC = CastChecked<ANeonNPC>(GetOwner());
	const UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	TSharedRef<FJsonObject> J = MakeShared<FJsonObject>();
	const UNPCIdentityComponent* Id = NPC->Identity;
	J->SetStringField(TEXT("npc_id"), Id->NpcId.ToString());
	J->SetStringField(TEXT("name"), Id->FullName());
	J->SetNumberField(TEXT("age"), Id->Age);
	J->SetStringField(TEXT("occupation"), Id->Occupation);
	if (const FNeonPlace* W = Sim->FindPlace(Id->WorkPlace)) J->SetStringField(TEXT("employer"), W->DisplayName);
	J->SetBoolField(TEXT("employed"), NPC->Needs->bEmployed);
	J->SetStringField(TEXT("backstory"), Id->Backstory.Left(1200));
	const FNeonPersonality& Pe = Id->Personality;
	TSharedRef<FJsonObject> PJ = MakeShared<FJsonObject>();
	PJ->SetNumberField(TEXT("friendliness"), Pe.Friendliness); PJ->SetNumberField(TEXT("aggression"), Pe.Aggression);
	PJ->SetNumberField(TEXT("confidence"), Pe.Confidence); PJ->SetNumberField(TEXT("curiosity"), Pe.Curiosity);
	PJ->SetNumberField(TEXT("empathy"), Pe.Empathy); PJ->SetNumberField(TEXT("honesty"), Pe.Honesty);
	PJ->SetNumberField(TEXT("risk_tolerance"), Pe.RiskTolerance); PJ->SetNumberField(TEXT("loyalty"), Pe.Loyalty);
	PJ->SetNumberField(TEXT("sociability"), Pe.Sociability);
	J->SetObjectField(TEXT("personality"), PJ);
	const UNPCEmotionComponent* E = NPC->Emotion;
	TSharedRef<FJsonObject> EJ = MakeShared<FJsonObject>();
	EJ->SetNumberField(TEXT("valence"), E->Valence); EJ->SetNumberField(TEXT("arousal"), E->Arousal); EJ->SetNumberField(TEXT("fear"), E->Fear);
	EJ->SetNumberField(TEXT("anger"), E->Anger); EJ->SetNumberField(TEXT("joy"), E->Joy); EJ->SetNumberField(TEXT("stress"), E->Stress);
	J->SetObjectField(TEXT("emotion"), EJ);
	J->SetStringField(TEXT("current_activity"), NeonTime::ActivityName(NPC->CurrentActivity));
	J->SetStringField(TEXT("location"), Sim->PlaceNameAt(NPC->GetActorLocation()));
	J->SetStringField(TEXT("game_clock"), Sim->Clock());
	const FNeonRelationship* R = NPC->Relationships->Find(NeonNames::Player);
	TSharedRef<FJsonObject> RJ = MakeShared<FJsonObject>();
	RJ->SetNumberField(TEXT("affinity"), R ? R->Affinity : 0.f); RJ->SetNumberField(TEXT("trust"), R ? R->Trust : 0.3f);
	RJ->SetNumberField(TEXT("familiarity"), R ? R->Familiarity : 0.f); RJ->SetStringField(TEXT("label"), NPC->Relationships->Label(NeonNames::Player));
	J->SetObjectField(TEXT("relationship_with_player"), RJ);
	if (const ANeonCharacter* PC = Cast<ANeonCharacter>(UGameplayStatics::GetPlayerPawn(this, 0))) J->SetStringField(TEXT("player_appearance"), PC->Appearance);
	static const TCHAR* Sources[] = { TEXT("Observed"), TEXT("Heard"), TEXT("ToldBy"), TEXT("Conversation"), TEXT("Self") };
	TArray<TSharedPtr<FJsonValue>> Mems;
	for (const FNeonMemory& M : Recalled)
	{
		TSharedRef<FJsonObject> MJ = MakeShared<FJsonObject>();
		MJ->SetStringField(TEXT("id"), M.Id);
		MJ->SetStringField(TEXT("summary"), M.Summary.Left(400));
		MJ->SetStringField(TEXT("event_type"), StaticEnum<ENeonEventType>()->GetNameStringByValue((int64)M.EventType));
		MJ->SetNumberField(TEXT("minutes_ago"), FMath::Max(0.0, (Sim->GameHours - M.GameTime) * 60.0));
		MJ->SetStringField(TEXT("place"), M.Place);
		MJ->SetStringField(TEXT("source"), Sources[(int32)M.Source]);
		if (const ANeonNPC* Src = Sim->FindNPC(M.SourceNpc)) MJ->SetStringField(TEXT("source_npc"), Src->Identity->FullName());
		MJ->SetNumberField(TEXT("confidence"), M.Confidence);
		MJ->SetNumberField(TEXT("importance"), M.Importance);
		Mems.Add(MakeShared<FJsonValueObject>(MJ));
	}
	J->SetArrayField(TEXT("memories"), Mems);
	TArray<TSharedPtr<FJsonValue>> PlacesJ;
	for (const FNeonPlace& Pl : Sim->Places)
		PlacesJ.Add(MakeShared<FJsonValueString>(FString::Printf(TEXT("%s (%s)"), *Pl.DisplayName, *NeonRuleDialogue::Directions(NPC->GetActorLocation(), Pl.Entrance))));
	J->SetArrayField(TEXT("known_places"), PlacesJ);
	TArray<TSharedPtr<FJsonValue>> Hist;
	for (const TPair<bool, FString>& H : History)
	{
		TSharedRef<FJsonObject> HJ = MakeShared<FJsonObject>();
		HJ->SetStringField(TEXT("speaker"), H.Key ? TEXT("player") : TEXT("npc"));
		HJ->SetStringField(TEXT("text"), H.Value.Left(600));
		Hist.Add(MakeShared<FJsonValueObject>(HJ));
	}
	J->SetArrayField(TEXT("history"), Hist);
	J->SetStringField(TEXT("player_line"), Text.Left(500));
	return J;
}

void UNPCDialogueComponent::HandlePlayerLine(const FString& InText, FOnReply OnReply)
{
	ANeonNPC* NPC = Cast<ANeonNPC>(GetOwner());
	const FString Text = InText.TrimStartAndEnd().Left(500);
	if (!NPC || Text.IsEmpty() || bAwaitingReply) return;
	// working memory: what the player just said
	{
		UNPCMemoryComponent::FParams P;
		P.Type = ENeonEventType::Conversation; P.Summary = FString::Printf(TEXT("The player said: \"%s\""), *Text.Left(160));
		P.Tags = NeonMemoryLogic::Tokenize(Text); P.Importance = 0.2f; P.Source = ENeonInfoSource::Conversation;
		P.Participants = { NeonNames::Player };
		NPC->Memory->Remember(P);
	}
	const TArray<FNeonMemory> Recalled = NPC->Memory->Recall(Text, 8);
	History.Emplace(true, Text);
	if (History.Num() > 12) History.RemoveAt(0);

	TSet<FString> Known; for (const FNeonMemory& M : Recalled) Known.Add(M.Id);
	UNeonAIClient* AI = GetWorld()->GetGameInstance()->GetSubsystem<UNeonAIClient>();
	TWeakObjectPtr<UNPCDialogueComponent> WeakThis(this);
	auto Finish = [WeakThis, OnReply, Text](const FNeonDialogueResult& R)
	{
		if (!WeakThis.IsValid()) return;
		WeakThis->bAwaitingReply = false;
		WeakThis->Apply(R, Text);
		OnReply(R);
	};
	bAwaitingReply = true;
	const bool bSent = AI && AI->Post(TEXT("/v1/dialogue"), BuildRequest(Text, Recalled), /*bHighPriority*/ true,
		[WeakThis, Known, Recalled, Text, Finish](bool bOk, TSharedPtr<FJsonObject> Body)
		{
			if (!WeakThis.IsValid()) return;
			FNeonDialogueResult R;
			if (!(bOk && NeonAIValidation::ParseDialogue(Body, Known, R)))
				R = NeonRuleDialogue::Respond(Cast<ANeonNPC>(WeakThis->GetOwner()), Text, Recalled); // service failed: stay grounded with rules
			Finish(R);
		});
	if (!bSent) Finish(NeonRuleDialogue::Respond(NPC, Text, Recalled));
}

void UNPCDialogueComponent::Apply(const FNeonDialogueResult& R, const FString& PlayerText)
{
	ANeonNPC* NPC = Cast<ANeonNPC>(GetOwner());
	if (!NPC) return;
	const double Now = NPC->Memory->Now();
	History.Emplace(false, R.Reply);
	if (History.Num() > 12) History.RemoveAt(0);
	Say(R.Reply, 6.f);
	NPC->Emotion->Stimulate(R.ValenceDelta, R.ArousalDelta, R.Intent == TEXT("flee") ? 0.3f : 0.f, R.AffinityDelta < -0.15f ? 0.3f : 0.f, FMath::Max(0.f, R.ValenceDelta));
	NPC->Relationships->Adjust(NeonNames::Player, R.AffinityDelta, R.TrustDelta, 0.06f, Now);
	if (R.bHasMemory)
	{
		UNPCMemoryComponent::FParams P;
		P.Type = ENeonEventType::Conversation; P.Summary = R.MemorySummary; P.Tags = R.MemoryTags;
		P.Importance = R.MemoryImportance; P.Source = ENeonInfoSource::Conversation; P.Participants = { NeonNames::Player };
		NPC->Memory->Remember(P);
	}
}
