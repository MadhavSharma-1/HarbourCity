#include "Core/NeonSimSubsystem.h"
#include "NPC/NeonNPC.h"
#include "NPC/NPCPerceptionComponent.h"
#include "ProjectNeon.h"
#include "Kismet/GameplayStatics.h"

void UNeonSimSubsystem::Tick(float DeltaTime)
{
	const UWorld* World = GetWorld();
	if (!World || !World->IsGameWorld()) return;
	GameHours += (double)DeltaTime * GameMinutesPerSecond * TimeSkipMultiplier / 60.0;

	if (const APawn* P = UGameplayStatics::GetPlayerPawn(World, 0)) PlayerLocation = P->GetActorLocation();

	const int32 Hour = FMath::FloorToInt(HourOfDay());
	if (Hour != LastHour)
	{
		LastHour = Hour;
		OnHourChanged.Broadcast(Hour);
		const int32 Day = NeonTime::Day(GameHours);
		if (Day != LastDay)
		{
			LastDay = Day;
			for (FNeonPlace& P : Places) P.DailyRevenue = 0.f;
		}
	}
}

void UNeonSimSubsystem::RegisterNPC(ANeonNPC* NPC) { NPCs.AddUnique(NPC); }
void UNeonSimSubsystem::UnregisterNPC(ANeonNPC* NPC) { NPCs.Remove(NPC); }

TArray<ANeonNPC*> UNeonSimSubsystem::GetNPCs() const
{
	TArray<ANeonNPC*> Out;
	for (const TWeakObjectPtr<ANeonNPC>& W : NPCs) if (W.IsValid()) Out.Add(W.Get());
	return Out;
}

ANeonNPC* UNeonSimSubsystem::FindNPC(FName Id) const
{
	for (const TWeakObjectPtr<ANeonNPC>& W : NPCs) if (W.IsValid() && W->GetNpcId() == Id) return W.Get();
	return nullptr;
}

const FNeonPlace* UNeonSimSubsystem::FindPlace(FName Id) const { return Places.FindByPredicate([Id](const FNeonPlace& P) { return P.Id == Id; }); }
FNeonPlace* UNeonSimSubsystem::FindPlaceMutable(FName Id) { return Places.FindByPredicate([Id](const FNeonPlace& P) { return P.Id == Id; }); }

const FNeonPlace* UNeonSimSubsystem::NearestPlace(ENeonPlaceType Type, const FVector& From, bool bMustBeOpen) const
{
	const FNeonPlace* Best = nullptr;
	float BestD = TNumericLimits<float>::Max();
	for (const FNeonPlace& P : Places)
	{
		if (P.Type != Type || (bMustBeOpen && !P.IsOpenAt(HourOfDay()))) continue;
		const float D = FVector::DistSquared(P.Entrance, From);
		if (D < BestD) { BestD = D; Best = &P; }
	}
	return Best;
}

FString UNeonSimSubsystem::PlaceNameAt(const FVector& Loc) const
{
	const FNeonPlace* Best = nullptr;
	float BestD = 3500.f * 3500.f;
	for (const FNeonPlace& P : Places)
	{
		const float D = FVector::DistSquared2D(P.Entrance, Loc);
		if (D < BestD) { BestD = D; Best = &P; }
	}
	return Best ? FString::Printf(TEXT("near %s"), *Best->DisplayName) : TEXT("on the street");
}

int32 UNeonSimSubsystem::NearestWaypoint(const FVector& P) const
{
	int32 Best = INDEX_NONE;
	float BestD = TNumericLimits<float>::Max();
	for (int32 i = 0; i < Waypoints.Num(); ++i)
	{
		const float D = FVector::DistSquared2D(Waypoints[i], P);
		if (D < BestD) { BestD = D; Best = i; }
	}
	return Best;
}

TArray<FVector> UNeonSimSubsystem::FindPath(const FVector& From, const FVector& To) const
{
	TArray<FVector> Path;
	const int32 S = NearestWaypoint(From), G = NearestWaypoint(To);
	if (S == INDEX_NONE || G == INDEX_NONE) { Path.Add(To); return Path; }
	TArray<float> Cost; Cost.Init(TNumericLimits<float>::Max(), Waypoints.Num());
	TArray<int32> Prev; Prev.Init(INDEX_NONE, Waypoints.Num());
	TArray<bool> Closed; Closed.Init(false, Waypoints.Num());
	Cost[S] = 0.f;
	// graph is small (a few hundred nodes): a simple O(n^2) A* is plenty
	for (;;)
	{
		int32 Cur = INDEX_NONE; float Best = TNumericLimits<float>::Max();
		for (int32 i = 0; i < Waypoints.Num(); ++i)
		{
			if (Closed[i] || Cost[i] == TNumericLimits<float>::Max()) continue;
			const float F = Cost[i] + FVector::Dist2D(Waypoints[i], Waypoints[G]);
			if (F < Best) { Best = F; Cur = i; }
		}
		if (Cur == INDEX_NONE || Cur == G) break;
		Closed[Cur] = true;
		for (int32 N : Links[Cur])
		{
			const float C = Cost[Cur] + FVector::Dist2D(Waypoints[Cur], Waypoints[N]);
			if (C < Cost[N]) { Cost[N] = C; Prev[N] = Cur; }
		}
	}
	for (int32 Node = G; Node != INDEX_NONE; Node = Prev[Node]) { Path.Insert(Waypoints[Node], 0); if (Node == S) break; }
	if (Path.Num() > 1 && FVector::Dist2D(Path[0], From) < 150.f) Path.RemoveAt(0);
	Path.Add(To);
	return Path;
}

void UNeonSimSubsystem::PublishEvent(FNeonWorldEvent Event)
{
	if (Event.Id.IsEmpty()) Event.Id = NewId();
	Event.GameTime = GameHours;
	EventHistory.Add(Event);
	if (EventHistory.Num() > 300) EventHistory.RemoveAt(0, 50);
	UE_LOG(LogNeon, Log, TEXT("[event] %s at %s"), *Event.Description, *Event.Location.ToCompactString());
	OnEventPublished.Broadcast(Event);
	for (ANeonNPC* NPC : GetNPCs())
	{
		if (NPC->GetNpcId() == Event.InstigatorId) continue;
		NPC->Perception->TrySenseEvent(Event);
	}
}

int32 UNeonSimSubsystem::ComputeTier(const ANeonNPC* NPC) const
{
	if (NPC->IsIndoors()) return 4;
	const float D = FVector::Dist(NPC->GetActorLocation(), PlayerLocation);
	if (D < 3000.f) return 1;
	if (D < 9000.f) return 2;
	return 3;
}

void UNeonSimSubsystem::RecordSale(FName PlaceId, float Amount)
{
	if (FNeonPlace* P = FindPlaceMutable(PlaceId)) P->DailyRevenue += Amount;
}
