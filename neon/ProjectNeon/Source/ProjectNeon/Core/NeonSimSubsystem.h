#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "Core/NeonTypes.h"
#include "NeonSimSubsystem.generated.h"

class ANeonNPC;

DECLARE_MULTICAST_DELEGATE_OneParam(FOnNeonWorldEvent, const FNeonWorldEvent&);
DECLARE_MULTICAST_DELEGATE_OneParam(FOnNeonHour, int32 /*HourOfDay*/);

/**
 * The world simulation: clock, places, sidewalk graph, event bus, simulation tiers, economy.
 * Events are not broadcast to every NPC's brain — each NPC's perception decides whether
 * it saw or heard the event. Information then spreads only through conversations.
 */
UCLASS()
class PROJECTNEON_API UNeonSimSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()
public:
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UNeonSimSubsystem, STATGROUP_Tickables); }
	virtual bool IsTickable() const override { return !IsTemplate(); }

	/* ── clock ── */
	double GameHours = 7.0;        // day 0 (Monday) 07:00
	float GameMinutesPerSecond = 1.f; // 1 real second = 1 game minute → a day lasts 24 real minutes
	float TimeSkipMultiplier = 1.f;
	float HourOfDay() const { return NeonTime::HourOfDay(GameHours); }
	FString Clock() const { return NeonTime::Clock(GameHours); }
	FOnNeonHour OnHourChanged;

	/* ── registry ── */
	void RegisterNPC(ANeonNPC* NPC);
	void UnregisterNPC(ANeonNPC* NPC);
	TArray<ANeonNPC*> GetNPCs() const;
	ANeonNPC* FindNPC(FName Id) const;

	/* ── places ── */
	TArray<FNeonPlace> Places;
	const FNeonPlace* FindPlace(FName Id) const;
	FNeonPlace* FindPlaceMutable(FName Id);
	const FNeonPlace* NearestPlace(ENeonPlaceType Type, const FVector& From, bool bMustBeOpen) const;
	FString PlaceNameAt(const FVector& Loc) const;

	/* ── sidewalk graph (built by the city generator) ── */
	TArray<FVector> Waypoints;
	TArray<TArray<int32>> Links;
	int32 NearestWaypoint(const FVector& P) const;
	/** A* over the sidewalk graph. Returns points ending exactly at To. */
	TArray<FVector> FindPath(const FVector& From, const FVector& To) const;

	/* ── events ── */
	/** Publish something that happened; nearby NPCs that can sense it will react and remember. */
	void PublishEvent(FNeonWorldEvent Event);
	FOnNeonWorldEvent OnEventPublished;
	TArray<FNeonWorldEvent> EventHistory; // for debugging / save; NPCs never read this directly
	/** Emergency calls NPCs made (the police system is planned for phase 3 — it will read these). */
	TArray<FNeonWorldEvent> EmergencyReports;

	/* ── simulation tiers ── */
	/** 1 = near & detailed, 2 = nearby background, 3 = distant/abstract, 4 = inside a building/unloaded. */
	int32 ComputeTier(const ANeonNPC* NPC) const;
	FVector PlayerLocation = FVector::ZeroVector;

	/* ── weather ── */
	/** 0 dry .. 1 soaked. Lowers tyre grip; set by ANeonEnvironment (rain). */
	float Wetness = 0.f;

	/* ── economy ── */
	float CityFuelPrice = 1.79f;
	void RecordSale(FName PlaceId, float Amount);

	FString NewId() const { return FGuid::NewGuid().ToString(EGuidFormats::Digits); }

private:
	TArray<TWeakObjectPtr<ANeonNPC>> NPCs;
	int32 LastHour = -1;
	int32 LastDay = 0;
};
