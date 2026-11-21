#pragma once

#include "CoreMinimal.h"
#include "NeonTypes.generated.h"

/** Everything an NPC can be doing. The decision controller picks one; the schedule proposes one. */
UENUM(BlueprintType)
enum class ENeonActivity : uint8
{
	Idle, Sleep, Commute, Work, Lunch, Leisure, Shop, Socialize, JobHunt, Wander,
	Investigate, Flee, CallEmergency, Confront, TalkToPlayer
};

UENUM(BlueprintType)
enum class ENeonPlaceType : uint8 { Home, Work, Cafe, Restaurant, Shop, Park, JobCenter, GasStation, Street };

UENUM(BlueprintType)
enum class ENeonMemoryTier : uint8 { Working, Episodic, Semantic };

/** Where a piece of knowledge came from. NPCs only know what reached them through one of these. */
UENUM(BlueprintType)
enum class ENeonInfoSource : uint8 { Observed, Heard, ToldBy, Conversation, Self };

UENUM(BlueprintType)
enum class ENeonEventType : uint8
{
	None, VehicleCrash, VehicleDamaged, NearMiss, PedestrianHit, Horn, SpeedingCar, Conversation,
	JobLost, JobFound, Argument, Reconciled, SawPlayer, PlayerVehicleSeen, EmergencyCall, Purchase
};

USTRUCT(BlueprintType)
struct FNeonPersonality
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Friendliness = 0.5f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Aggression = 0.2f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Confidence = 0.5f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Curiosity = 0.5f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Empathy = 0.5f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Honesty = 0.7f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float RiskTolerance = 0.4f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Loyalty = 0.5f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Sociability = 0.5f;
};

/** One memory. Matches the npc_memory table in neon/ai_service/app/schema.sql. */
USTRUCT(BlueprintType)
struct FNeonMemory
{
	GENERATED_BODY()
	UPROPERTY(BlueprintReadOnly) FString Id;
	UPROPERTY(BlueprintReadOnly) FName NpcId;
	UPROPERTY(BlueprintReadOnly) ENeonMemoryTier Tier = ENeonMemoryTier::Working;
	UPROPERTY(BlueprintReadOnly) ENeonEventType EventType = ENeonEventType::None;
	/** Id of the world event this memory is about (to avoid learning the same thing twice). */
	UPROPERTY(BlueprintReadOnly) FString EventId;
	UPROPERTY(BlueprintReadOnly) FString Summary;
	UPROPERTY(BlueprintReadOnly) TArray<FString> Tags;
	/** Game hours since day 0, 00:00. */
	UPROPERTY(BlueprintReadOnly) double GameTime = 0.0;
	UPROPERTY(BlueprintReadOnly) FVector Location = FVector::ZeroVector;
	UPROPERTY(BlueprintReadOnly) FString Place;
	UPROPERTY(BlueprintReadOnly) TArray<FName> Participants;
	UPROPERTY(BlueprintReadOnly) float Confidence = 1.f;
	UPROPERTY(BlueprintReadOnly) float Importance = 0.3f;
	UPROPERTY(BlueprintReadOnly) ENeonInfoSource Source = ENeonInfoSource::Observed;
	UPROPERTY(BlueprintReadOnly) FName SourceNpc;
	/** Emotional state when stored. */
	UPROPERTY(BlueprintReadOnly) float Valence = 0.f;
	UPROPERTY(BlueprintReadOnly) float Arousal = 0.f;
	/** Game hour after which the memory is forgotten; < 0 = keep. */
	UPROPERTY(BlueprintReadOnly) double ExpiresAt = -1.0;
};

/** Something that happened in the world. NPCs learn about it only if they perceive it. */
USTRUCT(BlueprintType)
struct FNeonWorldEvent
{
	GENERATED_BODY()
	UPROPERTY() FString Id;
	UPROPERTY() ENeonEventType Type = ENeonEventType::None;
	UPROPERTY() FVector Location = FVector::ZeroVector;
	UPROPERTY() double GameTime = 0.0;
	UPROPERTY() FName InstigatorId;
	UPROPERTY() FName VictimId;
	/** What an eyewitness would see, e.g. "a black sports car hit a parked blue hatchback". */
	UPROPERTY() FString Description;
	/** What someone who only heard it would know, e.g. "a loud crash". */
	UPROPERTY() FString SoundDescription;
	UPROPERTY() TArray<FString> Tags;
	UPROPERTY() float Severity = 0.5f;
	UPROPERTY() float AudibleRadius = 2500.f;   // cm
	UPROPERTY() float VisibleRadius = 4000.f;   // cm
	TWeakObjectPtr<AActor> Instigator;
};

USTRUCT(BlueprintType)
struct FNeonPlace
{
	GENERATED_BODY()
	UPROPERTY() FName Id;
	UPROPERTY() ENeonPlaceType Type = ENeonPlaceType::Street;
	UPROPERTY() FString DisplayName;
	/** Point on the sidewalk in front of the door. */
	UPROPERTY() FVector Entrance = FVector::ZeroVector;
	UPROPERTY() FVector Center = FVector::ZeroVector;
	UPROPERTY() float OpenHour = 0.f;
	UPROPERTY() float CloseHour = 24.f;
	/** Price of a typical purchase (meal, groceries, fuel per litre). */
	UPROPERTY() float Price = 0.f;
	UPROPERTY() float DailyRevenue = 0.f;
	UPROPERTY() bool bOperating = true;

	bool IsOpenAt(float Hour) const
	{
		if (!bOperating) return false;
		return OpenHour <= CloseHour ? (Hour >= OpenHour && Hour < CloseHour) : (Hour >= OpenHour || Hour < CloseHour);
	}
};

USTRUCT(BlueprintType)
struct FNeonScheduleEntry
{
	GENERATED_BODY()
	UPROPERTY() float StartHour = 0.f;
	UPROPERTY() ENeonActivity Activity = ENeonActivity::Idle;
	UPROPERTY() ENeonPlaceType PlaceType = ENeonPlaceType::Street;
};

USTRUCT(BlueprintType)
struct FNeonRelationship
{
	GENERATED_BODY()
	UPROPERTY() FName OtherId;
	UPROPERTY() float Affinity = 0.f;     // -1 enemy .. 1 close friend
	UPROPERTY() float Trust = 0.3f;       // 0..1
	UPROPERTY() float Familiarity = 0.f;  // 0 stranger .. 1 knows well
	UPROPERTY() float Romance = 0.f;      // 0..1
	UPROPERTY() double LastInteraction = -1.0;
	UPROPERTY() int32 Conflicts = 0;
};

/** A decision proposal (from utility scoring or the language model) before validation. */
USTRUCT(BlueprintType)
struct FNeonDecision
{
	GENERATED_BODY()
	UPROPERTY() ENeonActivity Activity = ENeonActivity::Idle;
	UPROPERTY() FName PlaceId;
	UPROPERTY() FVector Target = FVector::ZeroVector;
	UPROPERTY() float Priority = 0.f;
	UPROPERTY() FString Reason;
	UPROPERTY() FName PartnerId;
};

namespace NeonNames
{
	static const FName Player(TEXT("PLAYER"));
}

/** Game-time helpers. */
namespace NeonTime
{
	inline float HourOfDay(double GameHours) { return (float)FMath::Fmod(GameHours, 24.0); }
	inline int32 Day(double GameHours) { return (int32)FMath::FloorToDouble(GameHours / 24.0); }
	inline FString Clock(double GameHours)
	{
		const float H = HourOfDay(GameHours);
		const int32 Hh = FMath::FloorToInt(H), Mm = FMath::FloorToInt((H - Hh) * 60.f);
		static const TCHAR* Days[] = { TEXT("Mon"), TEXT("Tue"), TEXT("Wed"), TEXT("Thu"), TEXT("Fri"), TEXT("Sat"), TEXT("Sun") };
		return FString::Printf(TEXT("%s %02d:%02d"), Days[Day(GameHours) % 7], Hh, Mm);
	}
	/** "about ten minutes ago", "this morning", "yesterday". */
	FString Ago(double NowHours, double ThenHours);
	FString ActivityName(ENeonActivity A);
}
