#include "NPC/NPCPerceptionComponent.h"
#include "NPC/NeonNPC.h"
#include "NPC/NPCMemoryComponent.h"
#include "Vehicle/NeonVehicle.h"
#include "Player/NeonCharacter.h"
#include "Core/NeonSimSubsystem.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/World.h"

UNPCPerceptionComponent::UNPCPerceptionComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickInterval = 0.5f;
}

bool UNPCPerceptionComponent::CanSee(const FVector& Point, const AActor* IgnoreActor, float MaxRange) const
{
	const ANeonNPC* Owner = Cast<ANeonNPC>(GetOwner());
	if (!Owner || Owner->IsIndoors()) return false;
	const FVector Eye = Owner->GetActorLocation() + FVector(0, 0, 65);
	const FVector To = Point - Eye;
	const float Range = MaxRange > 0.f ? MaxRange : SightRange;
	if (To.SizeSquared() > Range * Range) return false;
	// very close things are noticed even outside the field of view
	if (To.Size() > 400.f)
	{
		const float CosA = FVector::DotProduct(Owner->GetActorForwardVector(), To.GetSafeNormal());
		if (CosA < FMath::Cos(FMath::DegreesToRadians(HalfFieldOfViewDeg))) return false;
	}
	FCollisionQueryParams Q(SCENE_QUERY_STAT(NeonSight), false, Owner);
	if (IgnoreActor) Q.AddIgnoredActor(IgnoreActor);
	FHitResult Hit;
	return !GetWorld()->LineTraceSingleByChannel(Hit, Eye, Point + FVector(0, 0, 40), ECC_Visibility, Q);
}

void UNPCPerceptionComponent::TrySenseEvent(const FNeonWorldEvent& E)
{
	ANeonNPC* Owner = Cast<ANeonNPC>(GetOwner());
	if (!Owner) return;
	const float D = FVector::Dist(Owner->GetActorLocation(), E.Location);
	ENeonInfoSource Source;
	if (D <= E.VisibleRadius && CanSee(E.Location, E.Instigator.Get(), E.VisibleRadius)) Source = ENeonInfoSource::Observed;
	else if (D <= E.AudibleRadius * HearingMultiplier * (Owner->IsIndoors() ? 0.4f : 1.f)) Source = ENeonInfoSource::Heard;
	else return; // this person has no way of knowing
	Owner->OnEventSensed(E, Source, D);
}

void UNPCPerceptionComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	ANeonNPC* Owner = Cast<ANeonNPC>(GetOwner());
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	if (!Owner || !Sim || Owner->IsIndoors() || Owner->SimTier > 2) return;
	APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn) return;
	const double Now = Sim->GameHours;

	if (const ANeonVehicle* Car = Cast<ANeonVehicle>(PlayerPawn))
	{
		// remember the player's car driving past: colour, type, where, how fast
		if (Now - LastSawPlayerVehicle > 0.15 && CanSee(Car->GetActorLocation(), Car, 3500.f))
		{
			LastSawPlayerVehicle = Now;
			const bool bFast = Car->GetSpeedKmh() > 60.f;
			UNPCMemoryComponent::FParams P;
			P.Type = ENeonEventType::PlayerVehicleSeen;
			P.Summary = FString::Printf(TEXT("A %s %s past %s."), *Car->GetDescription(), bFast ? TEXT("sped") : TEXT("drove"), *Sim->PlaceNameAt(Car->GetActorLocation()).Replace(TEXT("near "), TEXT("")));
			P.Tags = { Car->ColorName.ToLower(), Car->BodyType.ToLower(), TEXT("car"), TEXT("vehicle"), bFast ? TEXT("speeding") : TEXT("driving") };
			P.Importance = bFast ? 0.45f : 0.3f;
			P.Location = Car->GetActorLocation();
			P.Participants = { NeonNames::Player };
			P.ExpiresAt = Now + 30.0;
			Owner->Memory->Remember(P);
		}
	}
	else if (Now - LastSawPlayerOnFoot > 1.0 && FVector::Dist(PlayerPawn->GetActorLocation(), Owner->GetActorLocation()) < 1200.f && CanSee(PlayerPawn->GetActorLocation(), PlayerPawn))
	{
		LastSawPlayerOnFoot = Now;
		const ANeonCharacter* PC = Cast<ANeonCharacter>(PlayerPawn);
		UNPCMemoryComponent::FParams P;
		P.Type = ENeonEventType::SawPlayer;
		P.Summary = FString::Printf(TEXT("Passed %s %s."), PC ? *PC->Appearance : TEXT("a stranger"), *Sim->PlaceNameAt(PlayerPawn->GetActorLocation()));
		P.Tags = { TEXT("person"), TEXT("stranger") };
		P.Importance = 0.15f;
		P.Location = PlayerPawn->GetActorLocation();
		P.Participants = { NeonNames::Player };
		P.ExpiresAt = Now + 6.0;
		Owner->Memory->Remember(P);
	}
}
