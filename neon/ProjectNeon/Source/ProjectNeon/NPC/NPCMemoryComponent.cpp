#include "NPC/NPCMemoryComponent.h"
#include "NPC/NeonNPC.h"
#include "NPC/NPCEmotionComponent.h"
#include "AI/NeonMemoryLogic.h"
#include "Core/NeonSimSubsystem.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"

double UNPCMemoryComponent::Now() const
{
	const UWorld* W = GetWorld();
	const UNeonSimSubsystem* Sim = W ? W->GetSubsystem<UNeonSimSubsystem>() : nullptr;
	return Sim ? Sim->GameHours : 0.0;
}

bool UNPCMemoryComponent::KnowsEvent(const FString& EventId) const
{
	return !EventId.IsEmpty() && Memories.ContainsByPredicate([&](const FNeonMemory& M) { return M.EventId == EventId; });
}

bool UNPCMemoryComponent::Remember(const FParams& P)
{
	if (!P.EventId.IsEmpty())
	{
		if (FNeonMemory* Existing = Memories.FindByPredicate([&](const FNeonMemory& M) { return M.EventId == P.EventId; }))
		{
			// hearing about something again, or seeing it first-hand after a rumour, makes it more certain
			Existing->Confidence = FMath::Max(Existing->Confidence, FMath::Min(1.f, Existing->Confidence + P.Confidence * 0.3f));
			if (P.Source == ENeonInfoSource::Observed && Existing->Source == ENeonInfoSource::ToldBy) { Existing->Source = ENeonInfoSource::Observed; Existing->Summary = P.Summary; }
			Existing->Importance = FMath::Max(Existing->Importance, P.Importance);
			return false;
		}
	}
	FNeonMemory M;
	M.Id = FGuid::NewGuid().ToString(EGuidFormats::Digits);
	const ANeonNPC* Owner = Cast<ANeonNPC>(GetOwner());
	M.NpcId = Owner ? Owner->GetNpcId() : NAME_None;
	M.Tier = P.Tier;
	M.EventType = P.Type;
	M.EventId = P.EventId;
	M.Summary = P.Summary;
	M.Tags = P.Tags;
	M.GameTime = P.GameTimeOverride >= 0.0 ? P.GameTimeOverride : Now();
	M.Location = P.Location;
	const UWorld* W = GetWorld();
	if (const UNeonSimSubsystem* Sim = W ? W->GetSubsystem<UNeonSimSubsystem>() : nullptr) M.Place = Sim->PlaceNameAt(P.Location.IsZero() && Owner ? Owner->GetActorLocation() : P.Location);
	M.Participants = P.Participants;
	M.Confidence = FMath::Clamp(P.Confidence, 0.f, 1.f);
	M.Importance = FMath::Clamp(P.Importance, 0.f, 1.f);
	M.Source = P.Source;
	M.SourceNpc = P.SourceNpc;
	M.ExpiresAt = P.ExpiresAt;
	if (Owner && Owner->Emotion) { M.Valence = Owner->Emotion->Valence; M.Arousal = Owner->Emotion->Arousal; }
	// significant experiences go straight to episodic memory
	if (M.Tier == ENeonMemoryTier::Working && M.Importance >= 0.6f) M.Tier = ENeonMemoryTier::Episodic;
	Memories.Add(M);
	return true;
}

TArray<FNeonMemory> UNPCMemoryComponent::Recall(const FString& Query, int32 MaxResults) const
{
	return NeonMemoryLogic::Retrieve(Memories, Query, Now(), MaxResults);
}

TArray<FNeonMemory> UNPCMemoryComponent::Shareable(int32 MaxResults, double SinceHours) const
{
	TArray<FNeonMemory> C = Memories.FilterByPredicate([&](const FNeonMemory& M)
	{
		return M.Tier == ENeonMemoryTier::Episodic && M.Importance >= 0.45f && M.Confidence >= 0.35f && M.GameTime >= SinceHours
			&& M.EventType != ENeonEventType::SawPlayer && M.EventType != ENeonEventType::Horn;
	});
	C.Sort([](const FNeonMemory& A, const FNeonMemory& B) { return A.Importance * A.Confidence > B.Importance * B.Confidence; });
	if (C.Num() > MaxResults) C.SetNum(MaxResults);
	return C;
}

void UNPCMemoryComponent::SetFact(const FString& Key, const FString& Summary, const TArray<FString>& Tags, float Importance)
{
	const FString FactId = TEXT("fact:") + Key;
	if (FNeonMemory* M = Memories.FindByPredicate([&](const FNeonMemory& X) { return X.EventId == FactId; }))
	{
		M->Summary = Summary; M->Tags = Tags; M->Importance = Importance; M->GameTime = Now();
		return;
	}
	FParams P;
	P.Tier = ENeonMemoryTier::Semantic; P.Type = ENeonEventType::None; P.Summary = Summary; P.Tags = Tags;
	P.Importance = Importance; P.Source = ENeonInfoSource::Self; P.EventId = FactId;
	Remember(P);
}

void UNPCMemoryComponent::Consolidate()
{
	const double T = Now();
	for (int32 i = Memories.Num() - 1; i >= 0; --i)
	{
		FNeonMemory& M = Memories[i];
		if (M.ExpiresAt >= 0.0 && T > M.ExpiresAt) { Memories.RemoveAt(i); continue; }
		if (M.Tier == ENeonMemoryTier::Working && T - M.GameTime > 1.0)
		{
			if (M.Importance >= 0.4f) M.Tier = ENeonMemoryTier::Episodic; // worth keeping
			else Memories.RemoveAt(i);
		}
	}
	// episodic memories slowly lose importance (semantic facts don't)
	TArray<int32> Episodic;
	for (int32 i = 0; i < Memories.Num(); ++i)
		if (Memories[i].Tier == ENeonMemoryTier::Episodic) { Memories[i].Importance *= 0.998f; Episodic.Add(i); }
	if (Episodic.Num() > MaxEpisodic)
	{
		Episodic.Sort([&](int32 A, int32 B) { return Memories[A].Importance < Memories[B].Importance; });
		TArray<int32> Remove; for (int32 k = 0; k < Episodic.Num() - MaxEpisodic; ++k) Remove.Add(Episodic[k]);
		Remove.Sort([](int32 A, int32 B) { return A > B; });
		for (int32 Idx : Remove) Memories.RemoveAt(Idx);
	}
	int32 WorkingCount = 0;
	for (int32 i = Memories.Num() - 1; i >= 0; --i)
		if (Memories[i].Tier == ENeonMemoryTier::Working && ++WorkingCount > MaxWorking) Memories.RemoveAt(i);
}

TArray<TSharedPtr<FJsonValue>> UNPCMemoryComponent::ToJson() const
{
	static const TCHAR* Tiers[] = { TEXT("Working"), TEXT("Episodic"), TEXT("Semantic") };
	static const TCHAR* Sources[] = { TEXT("Observed"), TEXT("Heard"), TEXT("ToldBy"), TEXT("Conversation"), TEXT("Self") };
	const UEnum* EventEnum = StaticEnum<ENeonEventType>();
	TArray<TSharedPtr<FJsonValue>> Out;
	for (const FNeonMemory& M : Memories)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("memory_id"), M.Id);
		O->SetStringField(TEXT("npc_id"), M.NpcId.ToString());
		O->SetStringField(TEXT("tier"), Tiers[(int32)M.Tier]);
		O->SetStringField(TEXT("event_type"), EventEnum->GetNameStringByValue((int64)M.EventType));
		O->SetStringField(TEXT("summary"), M.Summary.Left(400));
		TArray<TSharedPtr<FJsonValue>> Tags; for (const FString& Tg : M.Tags) Tags.Add(MakeShared<FJsonValueString>(Tg));
		O->SetArrayField(TEXT("tags"), Tags);
		O->SetNumberField(TEXT("game_time"), M.GameTime);
		TArray<TSharedPtr<FJsonValue>> Loc = { MakeShared<FJsonValueNumber>(M.Location.X), MakeShared<FJsonValueNumber>(M.Location.Y), MakeShared<FJsonValueNumber>(M.Location.Z) };
		O->SetArrayField(TEXT("location"), Loc);
		O->SetStringField(TEXT("place"), M.Place);
		TArray<TSharedPtr<FJsonValue>> Parts; for (const FName& N : M.Participants) Parts.Add(MakeShared<FJsonValueString>(N.ToString()));
		O->SetArrayField(TEXT("participants"), Parts);
		O->SetNumberField(TEXT("confidence"), M.Confidence);
		O->SetNumberField(TEXT("importance"), M.Importance);
		O->SetStringField(TEXT("source"), Sources[(int32)M.Source]);
		O->SetStringField(TEXT("source_npc"), M.SourceNpc.IsNone() ? FString() : M.SourceNpc.ToString());
		O->SetNumberField(TEXT("valence"), M.Valence);
		O->SetNumberField(TEXT("arousal"), M.Arousal);
		O->SetNumberField(TEXT("expires_at"), M.ExpiresAt);
		Out.Add(MakeShared<FJsonValueObject>(O));
	}
	return Out;
}
